# 工业协议接入架构方案

> 状态：部分落地（Modbus TCP/RTU、Siemens S7 TCP、能力描述符、采集运行时与自动设备卡片已实现；其余协议仍为提案）
>
> 复核日期：2026-09-29
>
> 许可证前提：Lissio 永久保持开源，并以 `GPL-2.0-only` 分发。Rust workspace metadata 与仓库根 GPL v2 许可证文本保持一致；依赖仍只采用 `src-tauri/deny.toml` 已允许且完成兼容审查的许可证。
>
> 范围：Desktop/Web/CLI 共用后端中的工业协议客户端与数据采集。协议服务端、设备模拟、硬实时控制和合规认证不是默认构建的一部分。

设备树、父子装配、能力闭环和生命周期模型见
[device-tree.md](device-tree.md)。本文中的 `SourceFactory` / `SourceSession`
描述驱动内部的会话契约，设备拓扑统一模型以该文档为准。

## 核心决策

不把工业协议扩充为 `TransportConfig` 或 `ProtocolConfig` 的新变体，也不让工业 SDK 伪装成无状态字节解码器。把现有字节平面演进为统一的**流数据平面**：字节块、点位批、事件批和数值批都是带同一投递信封的强类型流；字节是其中一种 payload，而不是平面外的特殊通道。

统一的是来源身份、会话 epoch、序列、时间、缺口、生命周期、背压、诊断和扇出；各 payload 的路由、存储和热路径仍保持类型专门化。不能为了表面统一，让每个字节块经过动态 JSON、`Box<dyn Any>` 或巨型 `enum` 分派。

```text
Source 配置与 Driver 配置信封
    │ source_id + driver_id + schema_version + payload
    ▼
SourceFactory ── 迁移、校验、生成私有强类型配置
    │ open
    ▼
SourceSession ── 独占 socket/设备/SDK event loop、会话和重连
    ├── Transport ─► FlowEnvelope<BytesChunk> ─► BytePlan/Protocol transform ─┐
    └── Industrial SDK ─────────────────────────► FlowEnvelope<PointBatch>    │
                                                                         ▼
FlowHub ── 生命周期、epoch、typed lanes、有界队列、序列/缺口、诊断
    ├── CatalogLane ── 资源树、Descriptor、schema
    ├── StateLane ── 可合并的最新状态 ─► PointStore
    ├── EventLane ── 有序事件 ─────────► EventLog
    ├── CommandLane ── 读/写/调用 ─────► CommandLedger
    └── Transform ── 点位/字节解码、数值投影
                         │ FlowEnvelope<NumericBatch>
                         ▼
                   现有波形缓冲与节点图求值
```

首个实现是 `tokio-modbus` 的 Modbus TCP 与 RTU 客户端。它们验证统一平面的直接点位源；Serial/TCP 等设备验证字节源，Protocol/FrameDecoder 则成为 Bytes 到 Points/Numeric 的 transform。测试数据通过设备属性切换会话实现，不再伪装成独立设备类型。抽象不能只按寄存器轮询设计；OPC UA 的浏览/订阅/方法、MQTT 的 QoS/保留消息、IEC 104 的事件/控制语义必须能通过可选能力自然表达。

## 现有字节平面如何并入

当前 `TransportBackend` 返回 `TransportConnection`，数据平面订阅 `broadcast::Receiver<Vec<u8>>`，再由 `ProtocolEngine::feed(&[u8])` 产生 `DataFrame { timestamp, channels: Vec<f32> }`。它适合 JustFloat、FireWater、原始串口帧和 CAN 桥接编解码，不适合拥有会话语义的工业客户端：

- Modbus、S7、MELSEC 与 EtherNet/IP 主动发起请求并关联响应。
- OPC UA、MQTT、IEC 104、BACnet 与 KNX 可推送订阅或事件。
- OPC UA、IEC 与 BACnet 值携带质量、服务端时间和源时间；立即压成 `f32` 会永久丢失语义。
- 多数 SDK 必须持续轮询内部事件循环，并独占重连、保活、证书和订阅状态。
- EtherCAT、PROFINET 与 CANopen 绑定网络/CAN 接口，权限和实时约束与普通 TCP 不同。

因此协议 SDK 直接实现点位能力，现有 transport 则实现字节能力；两者共享 `SourceSession`、`FlowEnvelope` 和 FlowHub，但不共享错误的业务假设。

现有实现有两个必须保持的结构事实：

- `read_task` 会排空 `broadcast` 并拼接消息。对 TCP/串口流这通常安全，对 UDP datagram 或有消息边界的协议不安全。`BytesChunk` 必须声明 `Framing::Stream | Datagram | Message`，只有连续 Stream 且中间无 gap 才能拼接。
- `broadcast::RecvError::Lagged(n)` 只知道丢失消息数，不知道字节数。统一信封应记录 sequence gap 和 `lost_units`，不能伪造丢失字节数；遇到 gap 后流式 parser 必须收到 discontinuity/reset 信号，禁止跨缺口拼帧。

## 许可证与选型结论

### 许可证规则

项目 SPDX 表达式确定为 `GPL-2.0-only`。根许可证、所有 workspace package metadata、前端 package metadata、第三方通知和发布页面应保持一致，并由 CI 检查。下表是保守准入规则，不构成法律意见。

| 类别 | 策略 | 例子 |
|---|---|---|
| MIT、Apache-2.0、BSD、ISC | 优先；保留通知并通过依赖审计 | `tokio-modbus`、`rumqttc`、`ethercrab` |
| MPL-2.0 | 已在 `deny.toml` 放行；仍需记录修改文件及源码提供义务，保持文件边界 | `async-opcua`、`open62541` |
| LGPL、木兰宽松许可证 | 当前 `deny.toml` 未放行；除非单独完成兼容和分发审查，否则不用 | Snap7 Rust 绑定链 |
| GPL-2.0-only | 项目本身采用；第三方依赖仍须明确加入白名单并完成来源审查 | 暂无计划引入 |
| GPL-3.0-only | 与 GPL-2.0-only 分发存在版本兼容风险，不链接、不捆绑 | `knx-rs` |
| 非商业、非生产、source-available | 不属于开源依赖，永久排除 | `rodbus`、Step Function `dnp3` |

“源码可见”不等于开源。永久开源已消除采购许可证这一分支，所以 `rodbus` 和 Step Function `dnp3` 不再是产品候选，也不能把免费非生产条款当作社区版。

### 深化复核

| 协议 / crate | 决策 | 经核验的边界与引入方式 |
|---|---|---|
| Modbus / `tokio-modbus` 0.17 | **已实现** | MIT OR Apache-2.0；启用异步 TCP/RTU client，不启用 sync/server。TCP 使用回环测试服务，RTU 使用受控字节流验证；实际 feature 列表没有 ASCII。[文档](https://docs.rs/crate/tokio-modbus/latest) |
| Modbus / `rodbus` | **排除** | 免费许可仅覆盖非商业、非生产用途，不符合永久开源产品的可再分发承诺。[厂商许可](https://stepfunc.io/products/libraries/) |
| OPC UA / `async-opcua` | **第二优先，验证后引入** | MPL-2.0、纯 Rust、Tokio；client event loop 需要持续驱动，正好由端点 task 独占。仅启用 client 所需 feature，不引入 server/XML/JSON；0.x API 和互操作仍需锁版本验证。[上游](https://github.com/FreeOpcUa/async-opcua) |
| OPC UA / `open62541` | **互操作回退** | 安全高层绑定加成熟 C 栈，MPL-2.0 许可可接受；代价是 C/CMake、FFI 生命周期和三平台打包。[绑定](https://github.com/HMIProject/open62541) |
| MQTT / `rumqttc` 0.25 | **成熟度基准，不立即落锁** | Apache-2.0、Tokio、事件循环和外部背压模型成熟；但当前公开 issue 含依赖安全公告及 MQTT v5 会话/编码问题。只有选定版本通过 `cargo deny`、互操作和断线 QoS 测试才可采用。[上游](https://github.com/bytebeamio/rumqtt) |
| MQTT / `mqtt5` 0.38 | **并行技术验证** | MIT OR Apache-2.0，客户端支持 v3.1.1/v5、QoS、延迟确认、TLS/WS/QUIC；`default-features = false` 可去掉默认 Broker。项目发布密集、版本变化快、独立生产证据少，不能因功能表更长直接替代成熟度验证。[文档](https://docs.rs/crate/mqtt5/latest) |
| EtherNet/IP / `rust-ethernet-ip` | **需求驱动验证** | MIT、纯 Rust、三平台；标签、UDT 和批量显式消息有硬件测试。它不是周期性 Class 1 隐式 I/O，且当前 MSRV 较新，接入前须对齐仓库工具链。[上游](https://github.com/sergiogallegos/rust-ethernet-ip) |
| EtherCAT / `ethercrab` | **独立特权路线** | MIT OR Apache-2.0、async-first MainDevice；Linux/Windows 原始网卡权限与实时调度不适合普通桌面采集路径，macOS 不作为承诺平台。[上游](https://github.com/ethercrab-rs/ethercrab) |
| CANopen / `oze-canopen` | **仅 Linux 实验** | Apache-2.0，但依赖 Linux SocketCAN、不含对象字典、维护规模小；不是跨平台方案。[上游](https://github.com/ozontech/oze-canopen) |
| CANopen / `canopen-sdo` | **移出** | 未找到精确包名对应的可核验当前 crate/仓库。 |
| PROFINET / `pnio` | **移出桌面端** | Linux PREEMPT_RT IO-Device 栈，不是跨平台 IO Controller；500 µs 单一环境结果不能外推。[文档](https://docs.rs/pnio/latest/pnio/) |
| IEC 61850 / `iec61850` | **研究候选** | MIT、MMS 客户端，仍明确标记开发中；不含 GOOSE、SV、服务端，不能称“完整 IEC 61850”。[上游](https://github.com/mzaniolo/iec61850) |
| DNP3 / Step Function `dnp3` | **排除** | 非商业、非生产源码许可不是开源许可证。[许可](https://docs.stepfunc.io/dnp3/1.6.0/rust/dnp3/index.html) |
| DNP3 / OpenDNP3 等 | **暂无 Rust 默认方案** | Apache-2.0 的 OpenDNP3 是 C++ 且已归档；当前纯 Rust 替代缺乏足够维护与互操作证据。需要时单独立项，不能借 FFI 名义宣称跨平台 Rust 支持。 |
| IEC 104 / `iec104` | **需求驱动验证** | MIT、Tokio client/server、可选 TLS；API/行为仍演进且未覆盖全部可选类型。[上游](https://github.com/mzaniolo/iec104) |
| IEC 104 / `voltage_iec104` | **对照候选** | 纯 Rust 事件 API 合理，但更年轻、独立证据更少。[文档](https://docs.rs/voltage_iec104) |
| Siemens S7 / `tokio-s7` | **已接入** | Apache-2.0、纯 Rust/Tokio。锁定 0.1.7；适配器自管重连（SDK `auto_reconnect=false`，指数退避由会话状态机控制）、自行做 DNS 解析（SDK 仅接受字面 IP）。I/Q/M/DB 绝对寻址读走 BYTE transport（位在适配器侧解码），位写走原生 BIT transport；真实设备互操作与优化块 DB 限制仍待硬件验证。[上游](https://github.com/CrayfishGo/tokio-s7) |
| Siemens S7 / Snap7 绑定 | **不默认分发** | C/C++ FFI 加 LGPL/木兰许可证链不符合当前依赖白名单；只可作为外部互操作对照工具。 |
| MELSEC / `melsec_mc` | **实验候选** | MIT、Tokio TCP 与类型化读取已有实现；高层批量 API 和社区采用证据仍弱。[上游](https://github.com/tyaro/melsec_mc) |
| BACnet / `bacnet-rs` | **暂不发布** | MIT OR Apache-2.0，但上游明确未 production-ready，分段、告警/事件、趋势、调度、BACnet/SC 缺失。[状态](https://github.com/bacnet-rs/bacnet-rs) |
| KNX / `knx-rs` | **阻断** | GPL-3.0-only 不在当前白名单内，并与项目的 GPL-2.0-only 分发存在版本兼容风险。[上游](https://github.com/metaneutrons/knx-rs) |
| CoAP / `coap` 0.27 | **后续 IoT 候选** | MIT、Tokio，覆盖 Observe、分块传输、自定义 transport 和可选 DTLS；需要用资源发现能力而不是强行模拟寄存器。[文档](https://docs.rs/crate/coap/latest) |

Stars 和下载量只用于发现候选，不是发布证据。最终门槛是许可证、目标角色、协议能力、依赖安全、版本稳定、三平台构建和真实设备互操作。

### 当前推荐顺序

1. `tokio-modbus` TCP/RTU client：已建立统一流平面的直接点位源和自动能力卡片基线。
2. Siemens S7（`tokio-s7` 0.1.7）：已按同一合同落地 `s7-adapter`，覆盖轮询、合并读窗口、位写、退避重连与质量映射；真实设备互操作证据待补。
3. `async-opcua` client：验证富类型、浏览、订阅、质量、时间和方法能力。
4. MQTT 技术验证：同一套合同测试比较 `rumqttc` 与 `mqtt5`，不预先承诺胜者。
5. EtherNet/IP、IEC 104、MELSEC、CoAP：只按明确用户需求和可用硬件接入。
6. EtherCAT/CANopen/PROFINET：隔离为平台受限或特权进程路线。

## Crate 归属与依赖方向

仓库 DAG 允许 `transport → protocol → shared` 与 `desktop → transport/protocol`。建议新增：

| crate | 领域/层 | 唯一职责 | 直接依赖 |
|---|---|---|---|
| `flow` | `shared`，L0 | 泛型投递信封、来源/epoch/sequence、时间、缺口、方向和 payload kind 契约 | `serde`、`error` |
| `points` | `protocol`，L0 | 点位 ID、富类型值、质量、Descriptor、事件和命令契约 | `flow`、`serde`、`serde_json`、`error` |
| `acquisition` | `protocol`，L2 | Source/Driver trait、能力协商、端点生命周期、typed lanes、存储、投影和诊断 | `flow`、`points`、`error`、`tokio`、`async-trait`、`parking_lot` |
| `modbus-adapter` | `transport`，L4 | Modbus 私有配置、地址、请求规划、TCP/RTU 会话和错误映射 | `acquisition`、`flow`、`points`、`tokio-modbus` |
| `s7-adapter` | `transport`，L4 | Siemens S7 私有配置、大端编解码、读窗口规划、轮询会话、位写和错误映射 | `acquisition`、`flow`、`points`、`tokio-s7` |
| `opcua-adapter`、`mqtt-adapter` 等 | `transport`，L4 | 每个 crate 隔离一个外部 SDK 和协议特性 | `acquisition`、`flow`、`points` 与对应 SDK |

`backend-host` 是适配器装配的唯一业务入口，`lissio`、`backend-server` 与 `backend-cli` 组合根复用该装配。按 Cargo feature 注册第一方适配器，普通构建不拉入未启用的重依赖。消费者直接依赖类型所有者，不增加“全工业协议” facade，也不跨 crate glob re-export。`transport` L2 依赖 `flow` 并产出 `FlowEnvelope<BytesChunk>`；字节 backend 的会话实现留在驱动/适配器内部。

新 crate 必须同时增加 workspace 依赖、`[package.metadata.lissio]`、职责文档、架构表和架构测试。L4 以下不得出现具体协议 SDK。

## 统一投递信封：逻辑统一，物理分型

```rust
struct FlowEnvelope<T> {
    source_id: SourceId,
    connection_epoch: u64,
    first_sequence: u64,
    last_sequence: u64,
    observed_time_unix_ns: i64,
    direction: Direction,
    gap_before: Option<FlowGap>,
    payload: T,
}

struct BytesChunk {
    bytes: bytes::Bytes,
    framing: Framing,       // Stream、Datagram、Message
    boundary: Boundary,     // Complete、Start、Continue、End
}
```

`FlowEnvelope<T>` 是 Rust 内部合同，`T` 在编译期确定。字节热路径用 `FlowEnvelope<BytesChunk>`，点位热路径用 `FlowEnvelope<PointBatch>`，投影后用 `FlowEnvelope<NumericBatch>`；typed channel 不做逐包 downcast。`PayloadKind` 只用于冷路径注册、图编译、诊断和 IPC schema 协商。

`bytes::Bytes` 允许同一不可变块低成本 fan-out；只有确实需要拼接、变换或跨 IPC 时才复制。每条 typed lane 配置独立的容量、字节预算、合并和丢弃策略，避免大字节块挤占控制命令，也避免一个万能 channel 产生队首阻塞。

统一平面不意味着端口域消失。图编译仍拒绝 Bytes 直接连接 F32/Point；必须经过声明 `Transform<BytesChunk, PointBatch>` 或 `Transform<BytesChunk, NumericBatch>` 的节点。编译器可以复用通用 `DomainPlan<T>` 结构，但生成 Bytes、Point、Numeric 等分型计划，从而保持现有 `BytePlan` 的快速路由。

## 可扩展配置：信封稳定，载荷归驱动所有

中央 `EndpointConfig::{Modbus, OpcUa, Mqtt, ...}` 看似强类型，实际每加驱动都要修改 L0、Rust IPC、TypeScript union、AI schema 和迁移器，形成全局变化热点。因此稳定层只拥有版本化信封：

```rust
struct DriverId(String);

#[derive(Serialize, Deserialize)]
struct DriverPayload {
    driver_id: DriverId,
    schema_version: u32,
    payload: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct NodeDecl {
    id: NodeId,
    name: String,
    driver: DriverId,
    schema_version: u32,
    config: serde_json::Value,
    enabled: bool,
    capability_endpoint_id: Option<String>,
    children: Vec<NodeDecl>,
}

#[derive(Serialize, Deserialize)]
struct PointRef {
    point_id: PointId,
    address: DriverPayload,
    acquisition: AcquisitionIntent,
    projection: Option<ProjectionSpec>,
}
```

`serde_json::Value` 只允许存在于持久化/IPC 边界。适配器内部立即反序列化成私有 `ModbusConfig`、`OpcUaNodeId` 等类型，并完成范围、组合和跨字段校验；未经验证的 JSON 不能进入 `SourceSession`。

每个 `SourceFactory` 提供 manifest、配置/地址 JSON Schema 与 UI hints、语义校验及打开会话所需的私有已验证配置句柄。前端、AI/MCP 和导入器共用同一 schema 来源。

未知或未安装驱动的 payload 必须原样保留和再次保存，UI 标记“驱动不可用”；不能因当前构建缺少 feature 就删除用户配置。凭据仅保存 `CredentialRef`，实际秘密继续由系统凭据设施拥有。

## 稳定点位语义

### 富类型值

```rust
#[serde(tag = "kind", content = "value")]
enum PointValue {
    Null,
    Bool(bool),
    I64(i64),
    U64(u64),
    F64(f64),
    Decimal(String),
    String(String),
    Bytes(Vec<u8>),
    DateTime(i64),
    Enum { value: i64, label: Option<String> },
    Array(Vec<PointValue>),
    Struct(Vec<StructField>),
}
```

`Decimal` 使用规范十进制字符串，避免 JSON 与 JavaScript 丢失精度。IPC 中 `i64/u64` 同样使用字符串编码或稳定 tagged codec；二进制只在低频检查器使用 base64，大块数据改用二进制通道。数组和结构保持字段顺序及名称，不能退化为不可校验的任意 JSON。

### Descriptor、样本与质量

```rust
struct PointQuality {
    validity: Validity, // Good、Uncertain、Bad
    flags: u32,         // Stale、CommFailure、OutOfRange、Substituted 等
    native: Option<NativeStatus>,
}

struct PointSample {
    key: PointKey,
    value: Option<PointValue>,
    quality: PointQuality,
    source_time_unix_ns: Option<i64>,
    server_time_unix_ns: Option<i64>,
    received_time_unix_ns: i64,
}

struct PointBatch {
    delivery: DeliveryClass,
    samples: Vec<PointSample>,
}
```

`PointBatch` 始终由 `FlowEnvelope<PointBatch>` 承载，来源、epoch、sequence 和 gap 不在 payload 中重复。`PointDescriptor` 另存资源路径、名称、`PointDataType`、访问权、工程单位、语义和协议原生地址。通用质量只负责跨协议筛选和显示，`NativeStatus { domain, code, detail }` 完整保留 OPC UA StatusCode、Modbus exception、IEC quality descriptor 等原始语义。错误样本允许 `value = None`；不得用 `0` 或旧值伪装新数据。

墙钟时间与超时必须分开：源/服务端/接收时间使用 UNIX ns，超时和延迟只用 `Instant`。现有 `DataFrame.timestamp` 声称单调而实现取 UNIX 时间的歧义应另行修正，点位平面不继承该约定。

## 能力 trait：组合能力，不做最低公分母

不定义包含所有方法的巨型 `IndustrialDriver`，也不让每个调用都返回 `Unsupported`。工厂先声明能力，打开会话后返回可用能力句柄：

```rust
#[async_trait]
trait SourceFactory: Send + Sync {
    fn manifest(&self) -> &DriverManifest;
    fn config_schema(&self) -> DriverSchema;
    fn migrate(&self, input: DriverPayload) -> Result<DriverPayload>;
    fn validate(&self, input: &DriverPayload) -> Result<ValidatedConfig>;
    async fn open(&self, config: ValidatedConfig, ctx: DriverContext)
        -> Result<Box<dyn SourceSession>>;
}

#[async_trait]
trait SourceSession: Send {
    fn epoch(&self) -> u64;
    fn capabilities(&self) -> &SessionCapabilities;
    fn byte_source(&self) -> Option<&dyn ByteSourceCapability> { None }
    fn byte_sink(&self) -> Option<&dyn ByteSinkCapability> { None }
    fn discover(&self) -> Option<&dyn DiscoverCapability> { None }
    fn browse(&self) -> Option<&dyn BrowseCapability> { None }
    fn reader(&self) -> Option<&dyn ReadCapability> { None }
    fn subscriber(&self) -> Option<&dyn SubscribeCapability> { None }
    fn writer(&self) -> Option<&dyn WriteCapability> { None }
    fn caller(&self) -> Option<&dyn MethodCapability> { None }
    async fn close(self: Box<Self>) -> Result<()>;
}

#[async_trait]
trait ReadCapability: Send + Sync {
    async fn read(&self, request: ReadRequest) -> Result<ReadResult>;
}

#[async_trait]
trait SubscribeCapability: Send + Sync {
    async fn subscribe(
        &self,
        intent: SubscriptionIntent,
        sink: SampleSink,
    ) -> Result<EffectiveSubscription>;
}

#[async_trait]
trait WriteCapability: Send + Sync {
    async fn write(&self, request: WriteRequest) -> Result<WriteResult>;
}
```

所有可选 getter 都提供默认 `None`，增加新能力不会要求已有适配器立刻修改。生产接口用 `async_trait` 或显式 boxed future 保持 trait object 安全；连续数据通过有界 typed sink 发送，不在 trait 中暴露 SDK stream associated type。`ValidatedConfig` 是工厂创建的不透明句柄，包含 `driver_id`，管理器在 `open` 前验证所有权。

`SessionCapabilities` 不只是 bit flags，还包含最大读/写批量、时间戳、死区、周期范围、历史读取、事件过滤、QoS、幂等写、方法调用和浏览分页等限制。UI 与图编译器只展示当前会话真正支持的操作。

| 协议 | 主要能力 |
|---|---|
| Modbus | Read、Write；发现通常缺失，地址由用户或导入器提供 |
| OPC UA | Discover、Browse、Read、Subscribe、Write、Method，未来可加 History/Event |
| MQTT | Subscribe、Publish（映射为 Write）；QoS/retain/properties 保留在扩展参数 |
| EtherNet/IP | Discover、Browse tags、Read、Write；Class 1 I/O 必须是独立能力 |
| IEC 104 | Read/总召、Event、Command；select-before-operate 是专门命令模式 |
| CoAP | Discover resources、Read/Request、Observe、Write；block-wise 是限制信息 |

能力接口允许未来增加 `HistoryReadCapability`、`EventCapability`、`RawFrameCapability` 而不破坏已有适配器。第一方驱动随应用静态注册；第三方动态插件若进入目标，必须另设进程边界和版本化 wire protocol，Rust trait object 不能作为稳定 ABI。

## 获取意图与适配器私有规划

上层描述“想要什么”，适配器决定“如何高效取得”：

```rust
struct AcquisitionIntent {
    mode: AcquisitionMode,       // Auto、Poll、Subscribe、OnDemand
    requested_period_ms: Option<u64>,
    deadband: Option<Deadband>,
    priority: Priority,
    delivery: DeliveryClass,     // State 或 Event
}

struct EffectiveSubscription {
    accepted: Vec<PointId>,
    rejected: Vec<PointRejection>,
    effective_period_ms: Option<u64>,
    guarantees: DeliveryGuarantees,
    diagnostics: Vec<Diagnostic>,
}
```

管理器聚合同一端点的 intent，适配器编译私有计划：Modbus 合并同 unit/功能码/周期的连续寄存器；S7 遵守 PDU 和 area；CIP 使用 multi-service 且保留逐项错误；OPC UA 建立 monitored items；MQTT 合并 topic filters。不能把 Modbus 的连续地址策略写进通用核心。

实际周期、被降级的死区和拒绝原因通过 `EffectiveSubscription` 返回。配置变化先构建新计划，再原子替换；失败时保留旧计划并报告诊断。

## 运行时数据流与背压

### 来源监督器

每个来源有一个独占上游 transport/SDK 的受监督 Tokio task：

```text
Disabled → Validating → Connecting → Online
                       ↘ Backoff ─────┘
Online → Degraded → Backoff
任意活动状态 → Closing → Closed
```

每次成功重连递增 `connection_epoch`。FlowHub 丢弃旧 epoch 的延迟回调；点位来源重建订阅并把旧缓存标为 `Stale`，字节来源向所有有状态 parser 注入 discontinuity/reset。来源 task 自己轮询 socket 或 `async-opcua`/MQTT event loop；管理器不得持有注册表锁等待 I/O。

### 分型通道

| 通道 | 保序与满载策略 | 消费者 |
|---|---|---|
| Bytes | 按来源保序；Stream 可在连续且无 gap 时合并，Datagram/Message 保留边界；丢失后先发 discontinuity | BytePlan、RawData、Protocol/FrameDecoder transform |
| Catalog | 版本化快照/增量，按资源 ID 合并；分页有 continuation | 浏览器、配置 UI、AI 工具 |
| State | 每 key 只保留最新值，可合并；必须产生覆盖计数和 `PointGap` | PointStore、表格、波形投影 |
| Event | 有序、不可合并；满载时记录精确序列缺口，若协议支持则触发 backfill | EventLog、告警/事件视图 |
| Command | 小容量 FIFO；每条有 correlation 和 deadline；满载直接 `Busy` | 写入、方法调用、控制结果 |

所有队列同时限制消息数和估算字节数。字符串、数组、结构、证书和二进制不能绕过字节预算。来源 sink 返回拥塞信号；TCP 可停止读取以施加内核背压，串口/UDP 只能记录缺口，支持确认的上层协议可延迟 ACK 或降低采样，不支持者按 payload 的规则显式降级。

命令与遥测使用不同重试策略。读/订阅可有上限、退避和抖动；写入默认不自动重试，只有适配器证明幂等且请求携带 idempotency key 时才允许。select-before-operate、OPC UA Method、MQTT QoS ACK 都保留关联状态，不简化成普通写。

### 存储与扇出

- `PointStore`：每个 key 最新 descriptor、sample 和 epoch，内存上限可预测。
- `EventLog`：有界环形记录，包含 sequence、gap 和 ack 状态。
- `CommandLedger`：有界 pending/recent 结果，超时后仍能识别迟到响应。
- `SubscriptionHub`：按消费者需求合批、节流，不为每个样本 emit Tauri event。
- `DiagnosticsStore`：连接状态、重试、队列水位、覆盖/缺口、延迟、最后错误和协议原始码。

## 从富点位到现有图的数据投影

点位平面始终保存原值；只有显式 `ProjectionSpec` 才进入波形：

```rust
struct ProjectionSpec {
    target: NumericTarget,       // 当前为 F32，未来可增加 F64
    bool_mapping: Option<BoolMapping>,
    scale: f64,
    offset: f64,
    deadband: Option<Deadband>,
    invalid: InvalidPolicy,      // Gap、NaN、Drop；默认 Gap
    timestamp: TimestampPolicy,  // SourceThenReceive 等
    overflow: OverflowPolicy,    // Reject、Clamp；默认 Reject
}
```

整数/Decimal 到 `f32` 是显式有损转换，超出精确范围时产生诊断，不能静默截断。坏质量默认形成时间线缺口，不默认保持旧值；“保持最后值”若需要，必须是用户可见的派生算子。字符串走现有字符串域；Bytes/Array/Struct 先进入检查器，等图类型明确后再开放。

```text
PointBatch
  ├─ 完整值 ───────────────► PointStore / Inspector
  ├─ Delivery::Event ──────► EventLog
  └─ ProjectionSpec
       ├─ 类型/范围校验
       ├─ scale + offset + deadband
       ├─ quality/time policy
       └─ NumericBatch + quality sidecar ─► DataFrame/波形/求值
```

全局 `Endpoint` 节点持有连接引用和状态；各 tab 的 `PointSource` 只引用 endpoint/point/projection。沿用现有全局协议与 tab source 的所有权模式，但不把点位伪造成字节端口。

## 前端、IPC 与持久化

IPC 命令保持薄：注册/打开/关闭端点、读取 manifest/schema、浏览、读、订阅、写和方法调用。参数先经过 driver schema 和 Rust 语义校验，Tauri 层不实现协议逻辑。

前端从同一驱动注册表生成已启用驱动/许可证/平台/能力显示、JSON Schema 表单、点位浏览/导入、值/质量/时间表格、AI/MCP 工具 schema。只有 descriptor 和 session capability 同时允许时才显示操作控件；连接状态和数据质量分开呈现。

持久化快照包含工作区 schema 版本和每个 driver payload 版本；版本与当前不符时拒绝加载，不做历史版本迁移。解析失败不得覆盖原文件。未知驱动数据往返无损。

## 具体协议的功能切面

### Modbus TCP

- `tokio-modbus = { version = "0.17", default-features = false, features = ["tcp", "rtu"] }`。
- 客户端角色；coil、discrete input、input/holding register 读，单 coil、单/多 register 写；批量 `WriteRequest` 可包含多个点位。
- bool、16/32/64 位整数、f32/f64；byte/word order、scale/offset 全部显式。
- unit、功能码、周期和连续地址共同决定请求组，遵守 PDU 长度限制。
- exception、超时、断线转成通用质量并保留原始 exception code。
- 自定义 function 只通过受限扩展能力提供，不污染通用 Read trait。
- 不宣称 ASCII。泛型 transport 可用于 TLS 包装不等于自动实现 Modbus Security。

### Modbus RTU

RTU 与 TCP 共用点位、批量规划、质量、重连和取消语义；连接参数包含串口名、波特率、数据位、校验、停止位、流控、unit、超时与重连策略。发现只枚举本机串口，不主动扫描 unit ID。适配器直接独占打开串口，冲突由操作系统的独占打开错误报告；物理热拔插、不同 USB/RS-485 转换器的静默间隔和与 Serial/Slcan 的跨管理器仲裁仍需真实硬件验证。

### OPC UA

- `async-opcua` 只启用 client 所需 feature；SDK session event loop 归端点 task。
- 验证 discovery、browse continuation、read/write、subscription、deadband、事件、method、证书信任、数组、结构和 StatusCode。
- NamespaceIndex 可能变化，持久化优先保存 namespace URI 加 identifier，连接时解析。
- ExtensionObject 未知编码保持 opaque + type id；已知结构通过 schema 解码。
- 与至少两个独立服务端互操作，并做过期/未知/错误主机名证书负向测试。

### MQTT

- 桌面采集不内嵌 Broker；若使用 `mqtt5` 必须 `default-features = false`。
- `rumqttc` 与 `mqtt5` 使用同一合同测试比较：v3.1.1/v5、TLS、QoS 0/1/2、retain、will、session expiry、重连重订阅、重复投递、Receive Maximum 和恶意包。
- topic/payload 到点位由版本化 decode profile 显式定义；支持 JSON pointer、文本数值、二进制 codec 和 timestamp/quality 提取。
- retained 可配置为 State；普通 publish 默认 Event。QoS 不等于应用层 exactly-once，消费者用 endpoint epoch 加 packet/application id 去重。
- 任一候选若存在未缓解安全公告、断线语义不一致或关键互操作失败，则不进入发行构建。

### Siemens S7（已接入）

- `s7-adapter`（L4，`tokio-s7` 0.1.7 锁定）；TCP 102 端口，PG 连接角色，rack/slot/plcType 显式配置。
- I/Q/M/DB 绝对寻址（24 位 any-pointer：字节偏移 ≤ `0x1F_FFFF`）；DB 区必须显式 `dbNumber`，其余区禁止。
- 读统一走 BYTE transport：按 `(area, db, 周期)` 合并相邻字节为一个读窗口，窗口大小受协商 PDU 约束；布尔在适配器内按位解码，多布尔共用同一字节时天然合并。
- 位写走原生 BIT transport（BIT 变量类型 + 位地址），不触碰相邻位；tokio-s7 `write_bool` 文档警告不适用于该 wire 形态，但真实 PLC 行为仍需硬件验证。
- 大端为协议原生，无 Modbus 式 byte/word order 配置；8-bit 值在描述符中宽化为 U16/I16，投影值保持无损。
- 会话独占 SDK actor：`auto_reconnect=false`，断线（actor 退出/EOF/解析失败/socket 错误）由适配器指数退避重连并递增 epoch；对端 error class 应答视为请求级失败不断连。
- SDK 仅接受字面 IP，适配器在连接前自行做 DNS 解析；连接超时后向滞留 actor 发起尽力而为的优雅断开，残余 actor 最迟随 TCP 生命周期退出。
- S7-1200/1500 的优化访问 DB 无稳定绝对地址，需在 PLC 侧改为非优化块；适配器不做阻止，访问错误映射为 `returnCode:0x05` 级坏质量。

### 其他协议

EtherNet/IP 显式消息、S7、MELSEC、IEC 104、CoAP 分别使用独立适配器和合同测试。产品能力声明必须精确到角色和服务，例如“CIP 显式标签读写”，不能只写“支持 EtherNet/IP”。

EtherCAT、PROFINET 与 CANopen 需要平台权限/实时性边界，若进入产品应优先考虑最小权限 companion process，通过版本化 IPC 向桌面暴露点位；崩溃或网卡故障不能拖垮 UI 进程。

## 测试合同与发布门禁

`acquisition` 提供 SDK 无关的 adapter contract test suite，所有驱动至少复用：

- manifest/schema/迁移：旧配置迁移、未知字段往返、无效组合拒绝、秘密不落盘。
- 生命周期：取消、重复 close、重连、旧 epoch 回调、DNS/超时/半开、热拔插。
- 能力：声明能力与返回句柄一致，不支持能力不会出现在 UI/schema。
- 字节连续性：Stream/Datagram/Message 边界、无 gap 合并、gap 后 parser reset、不可知丢失量不伪造。
- 数据：值/质量/时间/native status 无损，batch sequence 与 gap 正确。
- 背压：State 合并、Event 缺口、Command Busy，内存和 task 数有界。
- 命令：correlation、deadline、迟到响应、非幂等写不重试。
- 投影：整数精度、NaN/溢出、坏质量、时间选择和 deadband。

每个适配器在 UI/文档出现“支持”前还必须满足：

| 领域 | 必需证据 |
|---|---|
| 构建 | 声明支持的 macOS arm64/x64、Windows x64、Linux x64；最小 feature 与全 feature |
| 架构 | `pnpm architecture`、`pnpm check:architecture`、`pnpm check:deps` |
| Rust | fmt、workspace clippy/all-targets、workspace test、`cargo deny check` |
| 前端 | typecheck、Vitest、生产构建、持久化 fixture |
| 协议 | golden frame、畸形/截断/超长输入、逐项错误与 native status |
| 负载 | 24 小时 soak、队列满载、断线风暴，无 task/内存增长 |
| 互操作 | 官方/厂商模拟器，加至少两种独立实现或设备；不可获得时明确降级为实验 |
| 安全 | TLS/证书负向测试、凭据不进工作区/日志、地址与文件路径校验 |
| 供应链 | SPDX、传递许可证、RustSec/advisory、锁文件和再分发通知可审计 |

crate 自测或与一台设备通信只能证明有限互操作，不能证明协议合规。任何“认证/合规”声明必须有公认测试套件或认证产物。

## 已落地结构与剩余边界

1. `flow` 已定义 `FlowEnvelope<T>`、Bytes 边界、epoch/sequence/gap 和序列化 fixtures。
2. `points` 已定义富类型、质量、时间、事件和命令契约。
3. `acquisition` 已定义 SourceFactory/能力 traits、mock source、来源监督器和 typed lanes。
4. `device-tree` 已统一节点拓扑、驱动合同、能力投影与子树生命周期。
5. `modbus-adapter` 已覆盖 TCP/RTU 请求规划、回环服务和受控 RTU 帧测试。
6. `s7-adapter` 已覆盖请求规划、mock 服务器、重连与质量映射。
7. `backend-host` 已统一注册来源，Desktop/Web/CLI/MCP 经同一能力面访问。
8. 剩余证据缺口是三平台发布构建、真实 PLC 互操作和长时间 soak，不代表接口尚未落地。

一个变更集不同时引入多个外部协议 SDK。公共合同用 mock 与 Modbus 走通后，OPC UA 用来证明抽象没有被寄存器模型绑死；MQTT 候选则先完成同合同对比再落锁。

## 仍需产品输入

- 可用于自动或人工回归的 PLC、OPC UA 服务端和 MQTT Broker 型号。
- 点位原始历史是否需要落盘；若需要，应保存富类型列式/事件数据，而不是只保存 `f32`。
- 服务器/设备模拟是否属于产品目标；若属于，需要独立角色、端口和威胁模型。
- 平台受限的硬实时协议是独立 companion service，还是完全不进入桌面产品。

这些输入不阻塞 Modbus TCP 在统一流平面中的闭环，也不影响上述稳定 trait 与数据合同。
