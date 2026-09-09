# Modbus 能力协议与自动设备卡片

## 稳定边界

后端 `acquisition` crate 是适配器、端点和端口能力的唯一事实来源。IPC 发布
`contractVersion = 1` 的 `AdapterCapability`，其中包含稳定的适配器 ID、协议、传输、
方向、操作能力、数据域、端点、端口、地址空间、配置 JSON Schema、运行可用性和可选
展示语义。展示语义只使用 `category`、`symbol` 和语义标签，不包含 Rust 类型名或 React
组件名。

Modbus TCP 的稳定适配器 ID 是 `modbus-tcp`，RTU 是 `modbus-rtu`。两者都发布一个
双向 `points` 端口，支持读取、轮询订阅和写入，覆盖以下零基地址空间：

| 区域 | 地址 | 读 | 写 |
|---|---:|---:|---:|
| Coils | 0–65535 | 是 | 是 |
| Discrete inputs | 0–65535 | 是 | 否 |
| Input registers | 0–65535 | 是 | 否 |
| Holding registers | 0–65535 | 是 | 是 |

点位类型包括 bool、16/32/64 位有符号与无符号整数、f32 和 f64；byte order、word
order、scale、offset 与轮询周期均由配置显式给出。TCP schema 描述 host、port、unit、
timeout、reconnect 和 points；RTU schema 以 portName、baudRate、dataBits、parity、
stopBits、flowControl 替代 TCP 地址。未知配置字段允许并在迁移/保存时保留。

## 前端投影规则

前端先获取并缓存能力目录，刷新操作会重新请求目录与发现结果。一个后端
`EndpointDescriptor` 必定投影为“连接设备”分组中一条与内置接口同形的单行入口；左侧只显示图标和
后端提供的名称。前端不维护协议名、驱动 ID、端口域或 React renderer 注册表。点击或拖入画布
均创建独立接口节点，选中后在已有的“属性”Tab 中由 JSON Schema 生成配置表单。因此新增适配器不需要新建前端面板。较新合同版本仍可
查看与编辑 schema 字段，但连接会被禁用，避免按旧合同误解释能力。

discovery 能力返回任意 `configurationPatch`；前端选中发现项后递归合并 patch，不假设配置
字段叫 `portName`。前端始终使用后端 schema 做表单生成和本地基础校验，再调用后端完成
迁移与语义校验。

## 会话和数据语义

打开会话后，适配器合并同一区域的连续寄存器请求并遵守 Modbus PDU 上限。读失败产生带
Modbus native status 的坏质量样本；协议 exception 不触发重连，超时和传输断开进入
degraded/backoff 并按有界指数延迟重连。每次成功连接推进 connection epoch，并将 sequence
重新从零开始。写操作不在不确定结果后自动重试；单点和多点写请求均返回逐项质量。

轮询任务共享工作区执行门：pause 阻止新批次并丢弃跨 epoch 的迟到结果，resume 推进执行
epoch 后继续，stop 结束任务。close 使用取消信号打断正在等待的 Modbus 请求。点位批进入
现有 `StateLane`，再由组合根的协议无关 observer 投影到数值数据总线；可精确表示的 bool、
整数和有限 f64 作为 Float 域进入现有四域推送。录制开启时使用现有 `RecordingHub::record_next`，因此
accepted/persisted 水位继续由统一记录生命周期维护。不能无损投影成 f64 的整数不会伪造值。

## 配置兼容

工作区文件新增可缺省的 `acquisition_endpoints`。每个画布实例有独立 ID，类型通过
`capabilityEndpointId` 关联到后端端点描述。未完成配置也作为草稿保存；连接时执行语义校验。
节点配置与位置随工作区恢复，节点删除和撤销重做同步到后端，删除时关闭对应会话。
旧工作区读取时得到空列表；旧 Modbus
schema v0 通过纯函数补入 reconnect 默认值并迁移为 v1，未知字段原样保留，未来版本拒绝
降级。未安装或未知驱动的信封可以无损读取、保存与再次写出，不会被工作区收集过程删除。

## 测试边界

TCP 测试使用进程内可控 Modbus 服务覆盖四类地址、连续批量、单/多寄存器写、逐项写错误、
exception、超时、断线重连、epoch、缓存、订阅、暂停/恢复/停止和请求取消。RTU 测试使用
Tokio duplex 字节流验证请求 CRC 和响应解码，无需串口硬件。前端 Vitest 覆盖目录缓存与
刷新、未知协议/传输/数据域的自动成卡、发现 patch 递归合并、schema 默认值和校验。

真实 PLC、USB/RS-485 适配器、电气终端、串口热拔插、厂商地址偏移习惯、长时间噪声环境、
跨平台串口权限、24 小时 soak 和多厂商互操作不由本地模拟测试证明，发布前必须另行验证。
