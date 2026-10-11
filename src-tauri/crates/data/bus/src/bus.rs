//! 进程内数据总线 — 克隆成本极低, 发布/订阅/背压计数

use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::actor::{
    COMMAND_CAPACITY, ControlCommand, ESTIMATED_TOPIC_COUNT, Metrics, PublishCommand, SAMPLE_BYTES,
    run_topic,
};
use crate::types::{RuntimeHealth, RuntimeLimits, SampleBatch, SampleStatus, TopicKey};

#[derive(Clone)]
struct TopicHandle {
    ingress: mpsc::Sender<PublishCommand>,
    control: mpsc::UnboundedSender<ControlCommand>,
    subscribers: Arc<AtomicU64>,
    overrun_pending: Arc<AtomicBool>,
}

struct Inner {
    topics: Mutex<HashMap<TopicKey, TopicHandle>>,
    subscriptions: Mutex<HashMap<u32, TopicKey>>,
    limits: RwLock<RuntimeLimits>,
    metrics: Arc<Metrics>,
}

/// 克隆成本很低的进程内数据总线。
#[derive(Clone)]
pub struct DataBus {
    inner: Arc<Inner>,
}

impl Default for DataBus {
    fn default() -> Self {
        Self::new(RuntimeLimits::default())
    }
}

impl DataBus {
    #[must_use]
    pub fn new(limits: RuntimeLimits) -> Self {
        Self {
            inner: Arc::new(Inner {
                topics: Mutex::new(HashMap::new()),
                subscriptions: Mutex::new(HashMap::new()),
                limits: RwLock::new(limits),
                metrics: Arc::new(Metrics::default()),
            }),
        }
    }

    pub fn set_limits(&self, limits: RuntimeLimits) {
        *self.inner.limits.write() = limits;
    }

    #[must_use]
    pub fn limits(&self) -> RuntimeLimits {
        *self.inner.limits.read()
    }

    #[must_use]
    pub fn health(&self) -> RuntimeHealth {
        self.inner.metrics.snapshot()
    }

    /// 某端口存在订阅时返回 true，供热路径避免构造无人消费的派生批次。
    #[must_use]
    pub fn is_active(&self, key: &TopicKey) -> bool {
        self.inner
            .topics
            .lock()
            .get(key)
            .is_some_and(|topic| topic.subscribers.load(Ordering::Relaxed) > 0)
    }

    #[must_use]
    pub fn active_topics_for_source(&self, source_node_id: &str) -> Vec<TopicKey> {
        self.inner
            .topics
            .lock()
            .iter()
            .filter(|(key, topic)| {
                key.source_node_id == source_node_id
                    && topic.subscribers.load(Ordering::Relaxed) > 0
            })
            .map(|(key, _)| key.clone())
            .collect()
    }

    pub fn set_source_status(&self, source_node_id: &str, status: SampleStatus) {
        for key in self.active_topics_for_source(source_node_id) {
            self.set_status(key, status.clone());
        }
    }

    pub fn record_ack(&self, sequence: u64, buffered_bytes: usize, render_ms: f64) {
        self.inner
            .metrics
            .last_ack_sequence
            .store(sequence, Ordering::Relaxed);
        let limits = self.limits();
        let minimum = 1_000_u64 / u64::from(limits.preview_fps_limit.max(1));
        let overloaded = render_ms > 16.0
            || buffered_bytes
                > limits
                    .preview_bandwidth_mb_per_sec
                    .saturating_mul(1024 * 1024);
        self.inner.metrics.recommended_interval_ms.store(
            if overloaded {
                minimum.saturating_mul(2)
            } else {
                minimum
            },
            Ordering::Relaxed,
        );
    }

    fn samples_per_topic(&self) -> usize {
        let bytes =
            self.limits().memory_budget_mb.saturating_mul(1024 * 1024) / ESTIMATED_TOPIC_COUNT;
        (bytes / SAMPLE_BYTES).max(4_096)
    }

    fn ensure_topic(&self, key: &TopicKey) -> Option<TopicHandle> {
        let existing = self.inner.topics.lock().get(key).cloned();
        if let Some(handle) = existing {
            return Some(handle);
        }
        let runtime = match tokio::runtime::Handle::try_current() {
            Ok(runtime) => runtime,
            Err(error) => {
                log::error!("无法启动数据 Topic Actor: {error}");
                return None;
            }
        };
        let (ingress, ingress_rx) = mpsc::channel(COMMAND_CAPACITY);
        let (control, control_rx) = mpsc::unbounded_channel();
        let handle = TopicHandle {
            ingress,
            control,
            subscribers: Arc::new(AtomicU64::new(0)),
            overrun_pending: Arc::new(AtomicBool::new(false)),
        };
        let mut topics = self.inner.topics.lock();
        if let Some(existing) = topics.get(key).cloned() {
            return Some(existing);
        }
        topics.insert(key.clone(), handle.clone());
        runtime.spawn(run_topic(
            key.clone(),
            ingress_rx,
            control_rx,
            self.samples_per_topic(),
            self.inner.metrics.clone(),
            self.limits(),
        ));
        Some(handle)
    }

    /// 非阻塞发布有效样本。Topic 队列溢出会被精确计数并转为 Overrun 状态。
    pub fn publish_samples(&self, key: TopicKey, timestamps: Arc<[u64]>, values: Arc<[f64]>) {
        if timestamps.is_empty() || timestamps.len() != values.len() {
            return;
        }
        let Some(topic) = self.ensure_topic(&key) else {
            return;
        };
        let count = values.len() as u64;
        if topic
            .ingress
            .try_send(PublishCommand { timestamps, values })
            .is_err()
        {
            self.inner
                .metrics
                .ingress_dropped
                .fetch_add(count, Ordering::Relaxed);
            if !topic.overrun_pending.swap(true, Ordering::Relaxed) {
                let total = self.inner.metrics.ingress_dropped.load(Ordering::Relaxed);
                let _ = topic
                    .control
                    .send(ControlCommand::SetStatus(SampleStatus::Overrun {
                        lost_samples: total,
                    }));
            }
        } else {
            topic.overrun_pending.store(false, Ordering::Relaxed);
        }
    }

    pub fn set_status(&self, key: TopicKey, status: SampleStatus) {
        if let Some(topic) = self.ensure_topic(&key) {
            let _ = topic.control.send(ControlCommand::SetStatus(status));
        }
    }

    pub async fn subscribe(
        &self,
        key: TopicKey,
        replay_limit: usize,
    ) -> Option<broadcast::Receiver<Arc<SampleBatch>>> {
        let topic = self.ensure_topic(&key)?;
        let (reply, response) = oneshot::channel();
        topic
            .control
            .send(ControlCommand::Subscribe {
                replay_limit,
                reply,
            })
            .ok()?;
        let receiver = response.await.ok()?;
        if topic.subscribers.fetch_add(1, Ordering::Relaxed) == 0 {
            self.inner
                .metrics
                .active_topics
                .fetch_add(1, Ordering::Relaxed);
        }
        Some(receiver)
    }

    pub fn unsubscribe(&self, key: &TopicKey) {
        let topic = self.inner.topics.lock().get(key).cloned();
        if let Some(topic) = topic {
            let previous =
                topic
                    .subscribers
                    .try_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                        Some(count.saturating_sub(1))
                    });
            if previous == Ok(1) {
                self.inner
                    .metrics
                    .active_topics
                    .fetch_sub(1, Ordering::Relaxed);
            }
        }
    }

    pub fn register_subscription(&self, subscription_id: u32, key: TopicKey) {
        self.inner.subscriptions.lock().insert(subscription_id, key);
    }

    pub fn unregister_subscription(&self, subscription_id: u32) {
        let key = self.inner.subscriptions.lock().remove(&subscription_id);
        if let Some(key) = key {
            self.unsubscribe(&key);
        }
    }

    pub fn ack_subscription(
        &self,
        subscription_id: u32,
        sequence: u64,
        buffered_bytes: usize,
        render_ms: f64,
    ) {
        if self
            .inner
            .subscriptions
            .lock()
            .contains_key(&subscription_id)
        {
            self.record_ack(sequence, buffered_bytes, render_ms);
        }
    }

    pub fn record_preview_skipped(&self, key: &TopicKey, skipped: u64) {
        let topic = self.inner.topics.lock().get(key).cloned();
        if let Some(topic) = topic {
            let _ = topic.control.send(ControlCommand::PreviewSkipped(skipped));
        }
    }

    pub fn ack(&self, key: &TopicKey, sequence: u64, buffered_bytes: usize, render_ms: f64) {
        let topic = self.inner.topics.lock().get(key).cloned();
        if let Some(topic) = topic {
            let _ = topic.control.send(ControlCommand::Ack {
                sequence,
                buffered_bytes,
                render_ms,
            });
        }
    }
}

#[cfg(test)]
#[path = "bus_tests.rs"]
mod tests;
