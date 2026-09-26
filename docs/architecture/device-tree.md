# 设备树统一架构

> 本文定义设备拓扑、驱动契约、运行时能力投影和生命周期模型，是设备与工业协议接入的架构依据。
>
> 目标是以可持久化设备树作为唯一设备模型：**节点表示装配关系，驱动表示节点行为，能力表示节点对外接口，父子关系决定生命周期和数据依赖**。


## 当前实现

`NodeDecl` / `NodeId` 是设备持久化和命令身份的唯一模型。生产装配和集成测试均通过 `DriverRegistry` 注册原生 `NodeDriver`，由 `DeviceTreeRuntime` 管理打开、能力投影和子树关闭。

- 字节驱动：`ByteDeviceDriver`，覆盖 Serial、TCP、UDP、CAN 传输和 TestData。
- 协议引擎：内置 `protocol-engine` 节点，配置为 `{ protocol, convertTo, schema }`，挂载在字节来源下；使用稳定节点 id 接入既有解析、波形和显示数据平面。
- 点位驱动：`ModbusTcpDriver`、`ModbusRtuDriver`、`S7Driver`。
- 诊断链：`CanChannelDriver` → `IsoTpNodeDriver` → `DiagnosticNodeDriver`，通过 typed ports 装配。
- 仿真：启用的 `simulation` 子节点接管父设备的数据来源；禁用子节点不影响真实设备打开。
- 共享会话：`SourceRuntimeBuilder` 构造私有 `source_runtime`；`source_ports` 提供数据端口。`SourceFactory` / `SourceSession` / `SourceSupervisor` 属于驱动内部的会话、仿真和重连合同。
- 查询：禁用或打开失败的子树保留全部节点和路径，后代不打开；关闭事件只报告当前节点自身的错误。

OBD-II / J1939 的设备树驱动及数据语义仍未实现。

## 1. 设计目标

设备装配关系统一由 `NodeDecl` 父子树表达，底层会话链路只存在于驱动实现内部：

```text
SerialBackend -> ModbusSession
CanTransportBackend -> BridgeCanBackend -> IsoTpSession
TcpClient -> S7Session
```

这种模型能够工作，但无法统一表达以下结构：

- 一个串口下挂多个协议子节点；
- CAN 字节链路经过帧协议、ISO-TP 和诊断服务；
- TCP/Serial 作为父连接，Modbus/S7 作为协议子节点；
- 仿真源、测试数据源和真实设备共享同一棵树；
- 子节点失败时只重启子树，不影响兄弟节点；
- 前端能力目录、设备列表和配置表单从同一份拓扑派生。

目标模型遵循以下不变量：

1. **一切设备都是节点**：字节设备、协议节点、点位端点、诊断服务和虚拟源都使用同一模型。
2. **父子关系就是装配关系**：子节点通过父节点暴露的 typed port 获取字节流、CAN 帧流或其它协议输入。
3. **能力是运行时接口**：能力声明必须与 `NodeRuntime` 的能力投影一致。
4. **驱动是行为实现**：驱动负责配置 schema、校验、打开、关闭和适配底层 SDK。
5. **拓扑是单一事实来源**：设备树同时生成配置表单、能力目录、设备状态和 IPC 视图。
6. **生命周期按子树传播**：父节点先于子节点打开，子节点先于父节点关闭；子节点失败只影响其子树。
7. **数据语义不丢失**：字节边界、帧类型、点位质量、时间戳、序列缺口和连接 epoch 继续由流数据平面承载。

## 2. 目标模型

### 2.1 持久化拓扑

```rust
pub struct DeviceTreeDocument {
    pub schema_version: u32,
    pub root: NodeDecl,
}

pub struct NodeDecl {
    /// 全树稳定标识；节点改名不改变 id。
    pub id: NodeId,
    /// 兄弟节点内唯一；用于派生人类可读路径。
    pub name: String,
    pub driver: DriverId,
    /// 驱动配置 schema 版本。
    pub schema_version: u32,
    /// 驱动专属配置，驱动负责反序列化和语义校验。
    pub config: serde_json::Value,
    pub enabled: bool,
    pub children: Vec<NodeDecl>,
}

pub struct NodePath(Arc<str>);
```

`NodePath` 由树结构派生，例如：

```text
/line0/serial0/modbus-rtu0/plc0
/line0/slcan0/can-channel0/isotp0/diag0
```

约束：

- `NodeId` 是持久化身份，不随节点改名变化；
- `NodePath` 只用于寻址、日志、事件和 UI 展示；
- 同一父节点下的 `name` 必须唯一；
- `children` 是有向无环拓扑；
- 驱动通过 `ChildPolicy` 声明允许的子节点角色和数量；
- 配置 schema 由驱动提供，树模型不再复制 Modbus、S7、串口等强类型配置结构。

`NodeDecl` 是节点身份和配置的唯一持久化模型；`TransportConfig` 仅作为具体字节驱动的配置值，不再表示独立节点。

### 2.2 节点角色

```rust
pub enum NodeRole {
    Bus,
    Protocol,
    Endpoint,
    Virtual,
}
```

| 角色 | 含义 | 示例 |
|---|---|---|
| `Bus` | 提供物理或逻辑连接、字节流或帧流 | Serial、TCP、UDP、Slcan、CandleLight |
| `Protocol` | 在父节点输入上执行协议编解码或会话 | Modbus、S7、CAN Channel、ISO-TP |
| `Endpoint` | 对外提供点位、命令或诊断服务 | PLC、UDS 服务、点组 |
| `Virtual` | 无物理设备的源或测试节点 | TestData、Simulation |

节点角色用于 UI 分组、生命周期策略和拓扑校验，不替代能力声明。

## 3. 驱动契约

```rust
#[async_trait]
pub trait NodeDriver: Send + Sync + 'static {
    fn id(&self) -> DriverId;
    fn role(&self) -> NodeRole;
    fn capabilities(&self) -> CapabilityMask;
    fn config_schema(&self) -> ConfigurationSchema;
    fn child_policy(&self) -> ChildPolicy;

    fn validate(
        &self,
        config: &serde_json::Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError>;

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError>;
}
```

### 3.1 父节点契约

`ParentContract` 只暴露子节点真正需要的输入：

```rust
pub struct ParentContract {
    pub role: NodeRole,
    pub capabilities: CapabilityMask,
    pub port_descriptors: Vec<PortDescriptor>,
}
```

驱动在 `validate` 中检查父节点是否满足最小输入，例如：

- Modbus RTU：父节点必须提供 `byte_source` 和 `byte_sink`；
- Modbus TCP：父节点必须提供 TCP 字节端口；
- ISO-TP：父节点必须提供 CAN 帧源和 CAN 帧接收端口；
- UDS Endpoint：父节点必须提供 ISO-TP 请求/响应端口。

父节点运行时通过能力投影提供实际 typed port，不允许子节点依赖某个具体 Rust 实现类型。

### 3.2 运行时契约

```rust
#[async_trait]
pub trait NodeRuntime: Send + Sync + 'static {
    fn node_id(&self) -> &NodeId;
    fn path(&self) -> &NodePath;
    fn driver(&self) -> &DriverId;
    fn state(&self) -> NodeState;

    fn as_byte_source(&self) -> Option<&dyn ByteSourceCapability> { None }
    fn as_byte_sink(&self) -> Option<&dyn ByteSinkCapability> { None }
    fn as_reader(&self) -> Option<&dyn ReadCapability> { None }
    fn as_subscriber(&self) -> Option<&dyn SubscribeCapability> { None }
    fn as_writer(&self) -> Option<&dyn WriteCapability> { None }
    fn as_invoker(&self) -> Option<&dyn InvokeCapability> { None }
    fn as_browser(&self) -> Option<&dyn BrowseCapability> { None }
    fn as_discoverer(&self) -> Option<&dyn DiscoverCapability> { None }

    async fn close(&self) -> Result<(), CloseError>;
}
```

`InvokeCapability` 对应现有 `CapabilitySet::method`，为 UDS 服务、设备方法和未来 OPC UA 方法提供统一入口：

```rust
#[async_trait]
pub trait InvokeCapability: Send + Sync {
    async fn invoke(
        &self,
        method: &str,
        args: serde_json::Value,
    ) -> AcquisitionResult<serde_json::Value>;
}
```

CAN 帧流是父子节点之间的 typed port，不直接混入通用点位能力：

```rust
#[async_trait]
pub trait CanFrameSourceCapability: Send + Sync {
    fn subscribe_frames(&self) -> FrameSubscription<CanFrame>;
}

#[async_trait]
pub trait CanFrameSinkCapability: Send + Sync {
    async fn send_frame(&self, frame: &CanFrame) -> Result<()>;
}
```

`IsoTpRequestCapability` 使用稳定端口 id `isotp.request-response`，向诊断 Endpoint 只暴露请求/响应载荷：

```rust
#[async_trait]
pub trait IsoTpRequestCapability: RuntimeCapabilities {
    async fn request(&self, data: Vec<u8>) -> Result<Vec<u8>, PortError>;
}
```

这样 CAN Channel、ISO-TP 和诊断节点可以形成清晰的父子链，同时不把 CAN 帧误当成普通点位或普通字节。

## 4. 能力声明与闭环校验

```rust
pub struct CapabilityMask {
    pub byte_source: bool,
    pub byte_sink: bool,
    pub read: bool,
    pub subscribe: bool,
    pub write: bool,
    pub invoke: bool,
    pub browse: bool,
    pub discover: bool,
}
```

每个节点必须满足：

```text
capabilities.byte_source == runtime.as_byte_source().is_some()
capabilities.byte_sink   == runtime.as_byte_sink().is_some()
capabilities.read        == runtime.as_reader().is_some()
capabilities.subscribe   == runtime.as_subscriber().is_some()
capabilities.write       == runtime.as_writer().is_some()
capabilities.invoke      == runtime.as_invoker().is_some()
capabilities.browse      == runtime.as_browser().is_some()
capabilities.discover    == runtime.as_discoverer().is_some()
```

校验由 `DriverRegistry::contract_check` 统一执行。驱动提供可用于合同检查的最小 fixture；fixture 只用于验证契约，不参与生产连接。

能力投影还必须满足：

- 子节点声明的父端口必须由父节点能力提供；
- `enabled: false` 节点不打开运行时，但仍在树中保留；
- 不支持的能力不得出现在 schema、UI 卡片或 IPC 能力目录中；
- 点位能力必须同时提供 `PointDescriptor` 或等价地址描述；
- `method` 能力必须提供方法名、参数 schema 和错误语义。

## 5. 生命周期与状态

```rust
pub enum NodeState {
    Disabled,
    Validating,
    Connecting,
    Online { connection_epoch: u64 },
    Degraded { detail: String },
    Backoff { attempt: u32 },
    Closing,
    Closed,
}
```

### 5.1 打开顺序

```text
父节点 validate
  -> 父节点 open
    -> 子节点 validate
      -> 子节点 open
```

父节点未达到 `Online` 时，不打开依赖它的子节点。父节点暴露的 typed port 必须在子节点 `open` 前完成初始化。

### 5.2 关闭顺序

```text
停止接受新命令
  -> 关闭叶子节点
    -> 关闭协议节点
      -> 关闭总线节点
        -> 释放底层 socket / serial / USB / SDK actor
```

`close` 必须幂等。节点关闭后，旧 epoch 的回调、订阅和写入结果不得写入新会话。

### 5.3 状态聚合

- `Disabled` 节点不参与父节点健康判断；
- 必需子节点失败时，父节点为 `Degraded`；
- 可选子节点失败时，父节点保持 `Online`，子节点自身进入 `Degraded` 或 `Backoff`；
- 只有子树执行重连，兄弟节点不受影响；
- 状态事件包含 `node_id`、`node_path`、`state`、`connection_epoch`、`error_kind` 和 `detail`。

## 6. 典型拓扑

### 6.1 串口字节设备

```text
serial0                         Bus
└── raw-endpoint0               Endpoint
```

`serial0` 提供 `byte_source` / `byte_sink`。RawData、JustFloat、FireWater 等协议节点可以继续挂在字节端口下。

### 6.2 Modbus RTU over Serial

```text
serial0                         Bus
└── modbus-rtu0                 Protocol
    └── plc1                    Endpoint
```

`modbus-rtu0` 从父节点取得字节端口，自己只负责 Modbus 会话、请求规划、点位读写和错误质量映射。

### 6.3 Modbus TCP / S7

```text
tcp-client0                     Bus
├── modbus-tcp0                 Protocol
│   └── plc1                    Endpoint
└── s7-0                        Protocol
    └── plc2                    Endpoint
```

连接参数归父节点，协议参数归协议节点。一个 TCP 连接下可以挂多个协议子节点，但驱动必须声明是否允许共享父连接。

### 6.4 CAN 诊断

```text
slcan0                          Bus
└── can-channel0                Protocol
    └── isotp0                  Protocol
        └── uds0                Endpoint
```

对应实现关系：

```text
Slcan / CandleLight
  -> ByteSourceCapability
  -> CanFrameSourceCapability / CanFrameSinkCapability
  -> IsoTpSession
  -> InvokeCapability
```

`DiagnosticEngine` 不再是树外的硬编码调用链，而是 `uds0` 或同类 Endpoint 节点的运行时实现。

### 6.5 虚拟设备

```text
root
├── test-data0                  Virtual
└── sim0                        Virtual
    └── point-group0            Endpoint
```

`TestDataBackend` 和 `SimulationSession` 都注册为 `NodeDriver`。它们不是隐含模式，而是用户可以在树中显式启用的虚拟节点。

## 7. 数据平面接口

设备树负责拓扑和生命周期，数据平面继续负责数据语义。节点端口返回流式 payload，不返回无类型的 `Vec<u8>`：

```text
NodeRuntime
  ├─ ByteSourceCapability -> FlowEnvelope<BytesChunk>
  ├─ ReadCapability       -> FlowEnvelope<PointBatch>
  ├─ SubscribeCapability  -> FlowEnvelope<PointBatch>
  └─ InvokeCapability     -> CommandResult
```

必须保留 `docs/architecture/data-plane.md` 中的以下约束：

- `Framing::Stream`、`Framing::Datagram`、`Framing::Message` 明确区分；
- `broadcast::Lagged(n)` 只折算丢失消息或丢失样本，不伪造丢失字节数；
- 出现 gap 后，流式 parser 必须收到 discontinuity 或 reset；
- `connection_epoch` 隔离旧连接回调；
- 点位质量、源时间、服务端时间、native status 不得压成普通 `f32`；
- State、Event、Command 使用不同投递语义；
- `TransportHandle` 的统计、配置和 loopback 行为迁移到 `ByteSourceCapability` / `ByteSinkCapability` 后仍需保留。

## 8. 前端与 IPC

`AdapterCapability`、`EndpointDescriptor` 和 `PortDescriptor` 从设备树投影生成：

```text
DeviceTreeDocument
  -> enabled nodes
  -> driver capability mask
  -> runtime state
  -> port descriptors
  -> AdapterCapability / EndpointDescriptor
```

同一棵树派生：

- 设备树 UI；
- 设备配置表单；
- 设备能力目录；
- 设备发现结果；
- 运行状态事件；
- CLI、MCP 和 Web RPC 的设备视图。

外部契约遵循 `docs/architecture/exits.md` 和 `docs/architecture/web-exit.md`：命令名、错误 `kind` 和事件名保持稳定；节点身份与持久化字段统一使用 `NodeDecl` / `NodeId`。

### 8.1 协议引擎的设备树与执行图

`protocol-engine` 使用 `schema_types::ProtocolNodeConfig`，字段为 `protocol`、可空的 `convertTo` 和可空的 `schema`。设备文档只持久化根节点及其 `children`；`graph_ops` 编译时递归派生协议执行节点，并依据树结构生成父节点字节输出到子节点 `in` 的内部边。这些内部边不写回工作区，显示控件的普通连线则可以直接引用协议子节点的稳定 id。

协议解析器继续由 `pipeline` 持有，复用既有的帧边界、缺口重置、协议转换和数值输出处理。设备树驱动负责父字节来源契约、运行状态和关闭隔离；其公开字节能力表示原始输入透传，不宣称已经提供解析后的点位或转换后的字节。画布中的协议 `out` 由执行图负责转换。

禁用节点及其后代仍保留身份和配置，但不生成输入装配边。显式画布连线不能覆盖协议树节点的 `in` 父依赖。旧工作区的独立 `Protocol` 图节点继续加载；新增设备树协议不要求改写旧文档。TestData 打开时使用第一个启用协议子节点的协议和 schema 决定生成数据的编码。

## 9. Crate 归属

建议新增独立 crate：

| crate | domain | layer | responsibility |
|---|---|---:|---|
| `device-tree` | `transport` | L2 | 设备树静态模型、`NodeDriver` / `NodeRuntime` 契约、能力闭环、子树生命周期、驱动注册表 |

依赖方向：

```text
device-tree
  -> acquisition
  -> data-model
  -> flow
  -> points
  -> error
  -> can            # CAN typed port 需要时

transport / modbus-adapter / s7-adapter / can-transport / automotive*
  -> device-tree

backend-host
  -> device-tree
```

`device-tree` 不依赖 Tauri、`serialport`、`nusb`、`tokio-modbus`、`tokio-s7` 或其它硬件 SDK。硬件和 SDK 实现继续留在 L4 适配器 crate 中。

`acquisition` 保留流数据和来源会话契约；生产 `NodeDriver` 直接实现驱动行为，并通过共享 session runtime 把 `SourceSession` 投影为 `NodeRuntime`。`ValidatedNodeConfig` 同时保留 JSON 配置和可选的驱动私有已验证句柄，避免打开时重新解释未验证配置。最终依赖图不得让 L0-L3 依赖 L4 适配器，也不得新增相邻层 facade。

## 10. 来源会话适配边界

所有驱动注册入口均接收 `NodeDriver`。设备树不导出通用来源兼容驱动，也不公开具体会话运行时类型。

`SourceRuntimeBuilder` 复用校验句柄、能力投影、重连、epoch 隔离和关闭逻辑；能力掩码只由 `source_capability_mask` 转换。来源会话是驱动内部实现，不是另一套持久化设备身份或全局端点注册表。

共享运行时测试通过固定测试驱动覆盖字节缺口、读写 epoch、点位、仿真和重连；pipeline、transport、Modbus、S7 集成测试直接注册对应生产驱动。

## 11. 测试与门禁

设备树必须通过以下测试组：

### 11.1 模型测试

- `NodeId` 稳定性；
- 兄弟节点名称唯一；
- 路径派生和节点改名；
- 无环校验；
- `ChildPolicy` 限制；
- `DeviceTreeDocument` 往返序列化。

### 11.2 驱动合同测试

每个 `NodeDriver` 至少覆盖：

- 配置 schema 和默认值；
- 无效配置拒绝；
- 能力声明与 `NodeRuntime` 投影一致；
- 父端口要求；
- `open` / `close` 幂等；
- 连接 epoch；
- 超时、断线、重连、取消；
- 能力不支持时不会出现在 UI 或 IPC。

### 11.3 拓扑测试

必须包含以下链路：

```text
serial -> modbus-rtu -> endpoint
tcp-client -> modbus-tcp -> endpoint
tcp-client -> s7 -> endpoint
slcan -> can-channel -> isotp -> diagnostic
root -> test-data
root -> simulation -> point-group
```

### 11.4 数据语义测试

- Stream / Datagram / Message 边界；
- gap 后 parser reset；
- 点位质量、时间戳、native status 无损；
- State 合并、Event 顺序、Command correlation；
- 父子节点关闭顺序；
- 子树失败不影响兄弟节点；
- 旧 epoch 数据不会写入新会话。

### 11.5 工程门禁

```bash
pnpm architecture
pnpm check:architecture
pnpm check:deps
pnpm typecheck
pnpm test
pnpm build
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --workspace --all-targets
cd src-tauri && cargo test --workspace
cd src-tauri && cargo deny check
```

## 12. 验收标准

设备树重构完成的判定条件：

1. 设备拓扑可以序列化、加载、校验和投影；
2. 所有设备通过 `NodeDriver` 注册，不再由 `backend-host` 硬编码平铺工厂列表；
3. 所有运行时能力都通过 `NodeRuntime` 投影暴露；
4. `CapabilityMask` 与能力投影在 CI 中逐项闭环；
5. `method` 通过 `InvokeCapability` 实现；
6. Serial、TCP、UDP、CAN、Modbus、S7、TestData、Simulation 都能在树中表达；
7. CAN → ISO-TP → Diagnostic 成为普通父子节点链；
8. 子树重连、关闭和状态聚合不依赖全局平铺 supervisor；
9. 前端、CLI、MCP、Web RPC 使用同一份树投影；
10. 设备注册只使用原生 `NodeDriver`；测试与持久化 fixture 只使用 `NodeDecl` / `NodeId`。

## 13. 结论

设备树的核心不是增加更多并列 trait，而是把**拓扑、驱动、能力、生命周期和状态聚合**收敛到同一模型：

```text
NodeDecl 描述“设备如何装配”
NodeDriver 描述“设备如何工作”
NodeRuntime 描述“设备现在能做什么”
DeviceTree 描述“系统现在有哪些设备”
```

在这套模型下，新增设备只需要实现驱动、注册驱动并在树中挂载节点。协议栈、总线适配、诊断服务、仿真源和真实设备共享同一套生命周期与能力规则。
