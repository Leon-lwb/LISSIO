//! 会话运行时的 typed port 和仿真装配实现。

use super::{SessionHandle, SourceRuntime};
use crate::capability::{
    BrowseCapability, ByteSinkCapability, ByteSourceCapability, DiscoverCapability,
    FrameSubscription, InvokeCapability, SimulationProviderCapability,
};
use crate::driver::{NodeContext, NodeRuntime};
use crate::error::{OpenError, PortError};
use crate::source_support::source_capability_mask as capability_mask;
use acquisition::{
    AddressSpaceDescriptor, DiscoveredEndpoint, DriverContext, EffectiveSubscription,
    ReadCapability, SampleSink, SubscribeCapability, SubscriptionIntent, WriteCapability,
};
use async_trait::async_trait;
use data_model::device::SimulationConfig;
use flow::{BytesChunk, FlowEnvelope, SourceId};
use points::{ReadRequest, ReadResult, WriteRequest, WriteResult};
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

use crate::source_support::SOURCE_CHANNEL_CAPACITY;

#[async_trait]
impl ByteSourceCapability for SourceRuntime {
    fn subscribe_bytes(&self) -> FrameSubscription<FlowEnvelope<BytesChunk>> {
        let (output, receiver) = broadcast::channel(data_model::INGEST_CHANNEL_CAPACITY);
        let source_id =
            SourceId::new(self.inner.node_id.to_string()).expect("node id is a valid source id");
        let inner = self.inner.clone();
        let mut sessions = match &inner.session {
            SessionHandle::Supervised(handle) => Some(handle.sessions()),
            _ => None,
        };
        if let Some(changes) = sessions.as_mut() {
            changes.borrow_and_update();
        }
        // 订阅必须在返回前建立；设备和测试源可在同一任务中立即发出首批字节。
        let mut initial = inner.session().and_then(|session| {
            session
                .byte_stream()
                .map(|handle| (session.epoch(), handle.subscribe_flow(source_id.clone())))
        });
        tokio::spawn(async move {
            let mut forwarded = 0_u64;
            let mut last_diag = Instant::now();
            loop {
                if inner.is_closed() || output.receiver_count() == 0 {
                    break;
                }
                let (epoch, mut input) = if let Some(initial) = initial.take() {
                    initial
                } else {
                    let Some(session) = inner.session() else {
                        if let Some(changes) = sessions.as_mut()
                            && changes.changed().await.is_ok()
                        {
                            continue;
                        }
                        break;
                    };
                    let Some(handle) = session.byte_stream() else {
                        break;
                    };
                    (session.epoch(), handle.subscribe_flow(source_id.clone()))
                };
                loop {
                    tokio::select! {
                        result = input.recv() => match result {
                            Ok(envelope) => {
                                if inner.is_closed() || envelope.connection_epoch != epoch
                                    || inner.session().map(|current| current.epoch()) != Some(epoch) {
                                    continue;
                                }
                                if output.send(envelope).is_err() { return; }
                                forwarded += 1;
                            }
                            Err(_) => {
                                if let Some(changes) = sessions.as_mut() {
                                    if changes.changed().await.is_err() { return; }
                                    break;
                                }
                                return;
                            }
                        },
                        () = async {
                            if let Some(changes) = sessions.as_mut() {
                                let _ = changes.changed().await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => break,
                    }
                }
                if last_diag.elapsed() >= Duration::from_secs(1) {
                    log::info!(
                        "字节订阅转发水位: input_queue={}, output_receivers={}, forwarded={}",
                        input.len(),
                        output.receiver_count(),
                        forwarded
                    );
                    last_diag = Instant::now();
                }
            }
        });
        FrameSubscription::from_receiver(receiver)
    }
}

#[async_trait]
impl ByteSinkCapability for SourceRuntime {
    async fn send_bytes(&self, envelope: &FlowEnvelope<BytesChunk>) -> Result<(), PortError> {
        self.try_send_bytes(envelope)
    }

    fn try_send_bytes(&self, envelope: &FlowEnvelope<BytesChunk>) -> Result<(), PortError> {
        if self.inner.is_closed() {
            return Err(self.inner.port_error("try_send_bytes", "节点已关闭"));
        }
        let session = self
            .session()
            .ok_or_else(|| self.inner.port_error("try_send_bytes", "连接正在重建"))?;
        if envelope.connection_epoch != session.epoch() {
            return Err(self.inner.port_error(
                "try_send_bytes",
                format!(
                    "连接 epoch 不匹配: {} != {}",
                    envelope.connection_epoch,
                    session.epoch()
                ),
            ));
        }
        session
            .byte_stream()
            .ok_or_else(|| {
                self.inner
                    .port_error("try_send_bytes", "字节写入能力不可用")
            })?
            .send(&envelope.payload.bytes)
            .map_err(|error| self.inner.port_error("try_send_bytes", error.to_string()))
    }
}

#[async_trait]
impl ReadCapability for SourceRuntime {
    async fn read(&self, request: ReadRequest) -> acquisition::AcquisitionResult<ReadResult> {
        if self.inner.is_closed() {
            return Err(acquisition::AcquisitionError::Closed);
        }
        let session = self
            .session()
            .ok_or(acquisition::AcquisitionError::Closed)?;
        let result = session
            .reader()
            .ok_or(acquisition::AcquisitionError::Unsupported("read"))?
            .read(request)
            .await?;
        if self.inner.is_closed()
            || self.inner.session().map(|current| current.epoch()) != Some(session.epoch())
            || result.batch.connection_epoch != session.epoch()
        {
            return Err(acquisition::AcquisitionError::Closed);
        }
        Ok(result)
    }
}

#[async_trait]
impl SubscribeCapability for SourceRuntime {
    async fn subscribe(
        &self,
        intent: SubscriptionIntent,
        sink: SampleSink,
    ) -> acquisition::AcquisitionResult<EffectiveSubscription> {
        if self.inner.is_closed() {
            return Err(acquisition::AcquisitionError::Closed);
        }
        let session = self
            .session()
            .ok_or(acquisition::AcquisitionError::Closed)?;
        let (forward_tx, mut forward_rx) = mpsc::channel(SOURCE_CHANNEL_CAPACITY);
        let effective = session
            .subscriber()
            .ok_or(acquisition::AcquisitionError::Unsupported("subscribe"))?
            .subscribe(intent, forward_tx)
            .await?;
        let inner = self.inner.clone();
        let epoch = session.epoch();
        tokio::spawn(async move {
            while let Some(envelope) = forward_rx.recv().await {
                if inner.is_closed()
                    || envelope.connection_epoch != epoch
                    || inner.session().map(|current| current.epoch()) != Some(epoch)
                {
                    continue;
                }
                if sink.send(envelope).await.is_err() {
                    break;
                }
            }
        });
        Ok(effective)
    }
}

#[async_trait]
impl WriteCapability for SourceRuntime {
    async fn write(&self, request: WriteRequest) -> acquisition::AcquisitionResult<WriteResult> {
        if self.inner.is_closed() {
            return Err(acquisition::AcquisitionError::Closed);
        }
        self.session()
            .ok_or(acquisition::AcquisitionError::Closed)?
            .writer()
            .ok_or(acquisition::AcquisitionError::Unsupported("write"))?
            .write(request)
            .await
    }
}

#[async_trait]
impl InvokeCapability for SourceRuntime {
    async fn invoke(&self, method: &str, args: Value) -> acquisition::AcquisitionResult<Value> {
        if self.inner.is_closed() {
            return Err(acquisition::AcquisitionError::Closed);
        }
        self.session()
            .ok_or(acquisition::AcquisitionError::Closed)?
            .invoker()
            .ok_or(acquisition::AcquisitionError::Unsupported("method"))?
            .invoke(method, args)
            .await
    }
}

#[async_trait]
impl BrowseCapability for SourceRuntime {
    async fn browse(&self) -> acquisition::AcquisitionResult<Vec<AddressSpaceDescriptor>> {
        if self.inner.is_closed() {
            return Err(acquisition::AcquisitionError::Closed);
        }
        Ok(self.inner.address_spaces.clone())
    }
}

#[async_trait]
impl DiscoverCapability for SourceRuntime {
    async fn discover(&self) -> acquisition::AcquisitionResult<Vec<DiscoveredEndpoint>> {
        if self.inner.is_closed() {
            return Err(acquisition::AcquisitionError::Closed);
        }
        self.inner.factory.discover()
    }
}

#[async_trait]
impl SimulationProviderCapability for SourceRuntime {
    async fn open_simulation(
        &self,
        config: SimulationConfig,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        if self.inner.is_closed() {
            return Err(OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.inner.driver.clone(),
                detail: "父节点已关闭".into(),
            });
        }
        let source_id =
            SourceId::new(context.node_id().to_string()).map_err(|error| OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.inner.driver.clone(),
                detail: error.to_string(),
            })?;
        let (state_sink, _state_rx) = mpsc::channel(SOURCE_CHANNEL_CAPACITY);
        let (event_sink, _event_rx) = mpsc::channel(SOURCE_CHANNEL_CAPACITY);
        let session = self
            .inner
            .factory
            .simulate(
                &self.inner.payload,
                &config,
                DriverContext {
                    connection_epoch: context.connection_epoch(),
                    source_id,
                    state_sink,
                    event_sink,
                    execution: self.inner.execution.clone(),
                },
            )
            .await
            .map_err(|error| OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.inner.driver.clone(),
                detail: error.to_string(),
            })?;
        acquisition::validate_capability_contract(session.as_ref()).map_err(|error| {
            OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.inner.driver.clone(),
                detail: error.to_string(),
            }
        })?;
        let declared = capability_mask(session.capabilities().available);
        Ok(Arc::new(Self::new(
            context.node_id().clone(),
            context.node_path().clone(),
            data_model::device_tree::DriverId::new(data_model::device_tree::SIMULATION_DRIVER_ID),
            self.inner.factory.clone(),
            self.inner.payload.clone(),
            session.into(),
            self.inner.ports.clone(),
            self.inner.address_spaces.clone(),
            false,
            false,
            declared,
            self.inner.execution.clone(),
        )) as Arc<dyn NodeRuntime>)
    }
}
