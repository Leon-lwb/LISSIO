# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定。

## [Unreleased]

### 变更

- **MCP 能力与 skill 改为软件能力节点动态派发**:`control-api` 新增 `capabilities` 能力节点注册表,每个能力域 (传输/图编辑/波形/CAN/逻辑分析/采集控制/命令帧/录制/知识库) 注册一个节点,声明自己的工具 (schemars JSON schema 从入参类型派生) 与技能文档;MCP 工具路由、内置 AI 工具规格与执行分发、skill 清单与系统提示词索引全部运行期从同一注册表动态派生,消除三处硬编码重复 (mcp-server 宏路由 43 工具 + params.rs DTO、ai-host specs.rs 手写 schema、skills.rs 静态数组,共删约 1900 行)
  - `mcp-server` 改为 `ToolRoute::new_dyn` 运行期构建路由,instructions 由注册表组装;工具执行失败返回 `CallToolResult::error` (AI 客户端可见原因),参数错误映射 invalid params
  - 内置 AI 与 MCP 共用同一份工具定义;`read_skill`/新增 `list_skills` 两个出口同源;技能文档随能力节点挂载 (`protocols`→transport、`nodes-reference`→graph、其余→knowledge)
  - 工具名统一:内置 AI `connect_nodes` 并入 `connect_edge`;工具参数缺省值统一 (如 `get_recent_waveform.count` 缺省 100);CAN 帧 `extended` 缺省按 id 位数推断
  - 技能文档迁至 `control-api/src/capabilities/docs/{zh,en}` (原 `src-tauri/src/commands/skills`);删除 `ai-host/src/skills.rs` 与 `AiError::SkillNotFound`
- **移除全部旧数据兼容层**:持久化文件、IPC payload 与配置只按当前格式读写,不再迁移或接受旧版本数据
  - 后端:删除 widget 参数旧形态迁移管线 (`press_value` 等 serde alias、Radio/Checkbox 旧模型、Gauge/Progress 顶层 min/max、Command 单帧包装);`NodeKind::Protocol.schema` 与 `ProtocolSource.port_names` 收紧为必填;删除 `CanBitrate` 大小写兜底、钥匙串/配置目录旧标识迁移;删除零调用的 `migrate_legacy_config` 与 no-op cargo features
  - 命名修正:`legacy_config` → `preset_config` (wire 同步)、`compile_legacy` → `compile_preset`、`LegacyFlowReceiver` → `BroadcastFlowReceiver`、`on_frames` → `record_and_eval`;删除 `data_model::Error/Result` 兼容重导出 (调用点直连 `error` crate)
  - 前端:删除 dock persist v1→v3 迁移、settings 明文 key/字体/主题迁移、旧通道 (channel) 回退链与 6 个 `@deprecated` 字段、`LegacyCommandConfig` 单帧包装、死别名 `CanFrameFilterOptions` / `DecoderBlockWire`
  - 文档:AGENTS.md 兼容条款改为「不维护旧格式兼容」,exits.md 兼容性红线改为契约稳定性,各架构文档的迁移承诺同步收紧

### 新增

- **全量能力与平台 shim**:Web 出口命令补齐,宿主专有能力收口到平台 shim
  - `get_graph_hir` 与 `parse_frame_decoder_input` 的实现体下沉到 `control-api`(新增 `graph_hir` / `frame_decoder` 模块),桌面 IPC 与 Web 出口共用同一份实现,不再各留一份;`catalog` 中两条命令由 `PENDING` 移入 `SUPPORTED`
  - 顺带修掉 `parse_frame_decoder_input` 的返回形状:补 `#[serde(rename_all = "camelCase")]`,前端读的 `consumedBytes` 由 `undefined` 恢复为真实字节数(桌面路径同修)
  - 文件产物交付:新增 `GET /api/v1/download/{token}` 与 `backend-host::ArtifactStaging` 受管暂存区;`export_waveform_csv` / `export_can_load_csv` 在 Web 出口写受管目录并把下载链接经 `notify` 帧下发,**不再接受客户端指定的服务器路径**(原 IPC 语义照搬进 HTTP 等于任意路径写入面)
  - `notify` 帧新增可选 `url` 并接入应用内提示:`Transport` 增加 `onServerNotify` / `downloadFile`,导出通知在 Toast 上给出"下载"动作;下载走带 `Authorization` 的 `fetch` 取字节流再保存,令牌不进 URL
  - CAN 负载 CSV 的格式化与本地时间换算下沉到 `control-api::can_export`(桌面写用户下载目录,Web 出口写暂存区),两个出口共用同一份实现
  - 设置持久化新增 `GET` / `PUT /api/v1/settings`:浏览器端没有 Tauri store,设置改由服务端落盘;文件仍是配置目录下的 `settings.json`,形状仍是 plugin-store 的 `{"app": …}`,因此**持久化格式对前端不变**,桌面与 Web 出口读写同一份设置(写入用临时文件 + rename,避免与桌面壳并发截断)
  - 新增 `src/lib/platform/` 平台服务 shim:把 `plugin-store` / `plugin-dialog` / `plugin-fs` / `plugin-opener` / `plugin-process` / `api/app` 与窗口控制收进一个运行时无关接口,由 `hasTauriRuntime()` 装配桌面或浏览器实现;~15 个调用点(设置、备份导入导出、附件、Markdown、录音面板、波形/CAN 导出、3D 控件、菜单栏)全部改走 shim,浏览器端因此拿到等价能力(服务端设置、Blob 下载、`<input type=file>` 句柄)或明确降级(退出仅告警、窗口控制 no-op)
  - `pnpm check:web-contract` 的出口泄漏门禁扩为两条并列规则:除 `src/lib/rpc/` 外禁止 `@tauri-apps/api/{core,event}` 与 `invoke()`/`listen()`(原有),**新增**除 `src/lib/platform/` 外禁止 import 任何 `@tauri-apps/*`(静态/动态 import 都匹配;`lib/rpc` 仅豁免本职的 `api/{core,event}`)
- **前端出口解绑**:新增 `src/lib/rpc/` 把前端调用从 Tauri API 上解绑,一份 `dist/` 既跑桌面壳也跑浏览器
  - `Transport` 契约(`call` / `listen` / `eventChannel` / `subscribe` / `onReconnect`)+ 两个实现:`tauriTransport`(invoke / listen / Channel)与 `httpTransport`(fetch + WebSocket + 订阅分流 + 重连 + 微批量)
  - `tauri.ts` 的 88 个方法签名不变,内部改走 `transport.call`;显示订阅、事件监听、store 与工具宿主全部收口到 transport,~100 处调用点与 40+ 组件零改动
  - 订阅建立失败经 `onError` 上报(Web 侧由新增的 `fault{id}` 归位),`settled` 表示在途建立结束,取消竞态在两个出口都不漏注销;`ack_data` 背压反馈在两侧都能拿到订阅 id
  - Web 出口断线按 500ms→8s 退避重连,重连后按原顺序重订全部活跃流并触发重新水合(`workspace_get` / `get_source_graph` / `get_workspace_run_state`)
  - 端点与令牌解析:`?server=`/`?token=` → localStorage → `VITE_LISSIO_SERVER`/`VITE_LISSIO_TOKEN` → 同源;查询参数写回 localStorage 后从地址栏摘除(令牌不进浏览器历史),反向代理路径前缀保留
  - `pnpm check:web-contract` 新增"出口泄漏"门禁:除 `src/lib/rpc/` 外禁止 import `@tauri-apps/api/{core,event}` 或直接调用 `invoke()`/`listen()`
- **Web 出口(服务后端拆分)**:把服务后端从 Tauri 宿主中拆出为可独立运行的服务,前端一份构建既可跑在桌面壳也可跑在浏览器(设计见 `docs/architecture/web-exit.md`)
  - 新增 `rpc-api`(L4):出口无关的命令派发表——桌面 IPC 与 HTTP-RPC 拥有同一套命令名、参数名与错误契约;`catalog` 声明 `SUPPORTED`/`PENDING`/`DESKTOP_ONLY`/`CHANNEL` 四类能力边界
  - 新增 `backend-server`(L5)与二进制 `lissio-server`:axum HTTP-RPC + WebSocket 推送、Bearer 与子协议令牌鉴权、`/health` 与 `/capabilities`、可选内嵌 MCP 与静态站点托管;后端事件经 `BroadcastEventSink` 广播、显示流经 `WsStreamSink` 推送,二进制帧(`WWB1`/`VNDP`/`VENV`)加固定头部后原样透传
  - `backend-host` 新增 `BackendHost`/`assemble`/`teardown`:装配与生命周期从 `backend-cli` 上移,GUI 与全部无界面出口共用同一份实现
  - `backend-cli` 新增 `serve --http`(默认同时提供 Web 出口与 MCP)与 `rpc <cmd> [--args <json|@file>]` 通用逃生口,原有子命令面保持不变
  - 契约门禁 `pnpm check:web-contract`:校验四个能力清单两两不相交且并集覆盖 `generate_handler!` 注册的全部命令,`SUPPORTED` 与派发分支一一对应,前端 `invoke` 名均在 IPC 注册表内
  - 逻辑收敛:工作区水合快照组装下沉到 `app::workspace_snapshot`、流水线配置钳制下沉到 `PipelineConfig::sanitized`、CAN 波特率决策下沉到 `app::can_bitrate_bps`,消除出口间重复
- **软件出口统一(UI / CLI / MCP)**:一份能力核心 + 一份无界面装配 + 两个推送端口,三个薄协议适配器,零业务重复(详见 `docs/architecture/exits.md`)
  - 无界面宿主 `backend-cli`:子命令(devices/send/inject/endpoint/graph/data/snapshot/frame/run/record)+ `serve` 常驻(恢复工作区、启动录制、进程内 MCP server),装配与 GUI 组合根同源(`backend-host`)
  - 能力核心 `control-api` 补齐无头场景能力:录制会话生命周期/历史/SQL/导出(含暂停态门控)、波形停止快照与 CSV 导出、命令帧编码与统一发送内核、缓冲容量控制;Tauri IPC 的 buffer/recording/rawdata 命令体改为委托同一实现(签名与错误文案不变)
  - MCP 工具面 25 → 41:新增录制 9 件套、停止快照/CSV 导出、命令帧打包/发送;工具路由按域拆分(`handlers/{data,recording}`)后与主路由合并
  - 流式订阅端口 `app::display::StreamSink` 与后端事件端口 `events::BackendEventSink`:Tauri 实现收口组合根(`TauriEventSink`/`TauriChannelSink`),无界面宿主注入 stderr JSON-lines
  - 串口发现与 GPU 包络引擎端口化(`app::SerialDiscovery` / `waveform::EnvelopeEngine`):L4 实现(`serial`/`gpu`)由 `backend-host` 统一注入,`app`/`control-api` 不再依赖 adapter SDK
  - 层级元数据修正:`pipeline`/`stream`/`evaluator` 归位 L2、`graph_ops`/`control-api` L3、`backend-host`/`mcp-server` L4、`backend-cli` L5,`pnpm check:architecture` 恢复层序约束力;新增 `docs/architecture/exits.md`
- 性能验证体系:`waveform_pyramid_bench` / `ingest_bench` / `eval_bench` / `pipeline_soak` 覆盖金字塔、摄入、图求值与端到端长跑,`bench-audit` 汇总可用证据
- 基准结果采集器 `scripts/bench-collect.mjs`:把 Criterion 统计量与自定义基准的 JSON 行归一成可提交的 JSON / CSV,并支持对基线做带容差的回归比较

### 修复

- **恢复完成门在无界面出口失效**:`AppState` 构造时丢弃初始 receiver,而 `backend-host::assemble` 在装配期同步发信号 —— `tokio::sync::watch::Sender::send` 在零接收者时不写入值,导致迟到的订阅者永远等不到 `changed()`。表现为 `lissio-server` / `backend-cli serve` 下 `workspace_get` 永久挂起(浏览器端无法水合工作区),且工作区防抖落盘循环空转(`workspace.json` 从不写出)。改用无条件写入的 `send_replace`,并补两条时序回归测试
- `pipeline_soak` 长跑基准:生成器控制句柄被提前丢弃,导致生成任务立即退出并关闭广播通道,基准直接 panic;摄入停顿场景被无条件套用"零丢弃"断言,与它人为制造超预算突发补交的场景设计自相矛盾。现按场景表达契约(常规零丢弃,降级场景要求有界且逐帧可记账)
- `scripts/bench-audit.sh` 整体失效:crate 改名后包名失配(旧名 `data_plane` / `app_state` / `engine`),且管道退出码取自 `tee` 使编译失败被判为通过;同时补入录制落盘与 Modbus 负载基准

### CI

- 新增 `pnpm bench:audit` / `bench:full` / `bench:collect` / `bench:check` 入口

## [0.6.1] - 2026-09-09 (pre-release)

### 新增

- 串口枚举携带丰富元数据:端口类型、USB VID/PID、序列号、厂商与产品名,macOS / Windows / Linux 分平台补全
- 采集设备面板与发现端点列表:可用串口端点直接选择,新增连接不再需要手动填写端口
- 一键默认画布:自动创建 Serial → JustFloat → RawData 管线,选中串口节点并打开属性面板
- 控件面板重构为分类目录(连接 / 处理 / 展示 / 扩展),活动栏分类入口替代跳转条
- Schema 字段标签中/英双语

### 修复

- 启动播种改为异步安全:不重复建节点、不覆盖已恢复的工作区

### CI

- lint 工作流新增三平台串口发现契约测试(serial、modbus-adapter、can-transport)
- 发布流水线:release 校验允许构建 head 提交为发布提交的祖先(覆盖自动 version bump 提交)

## [0.6.0] - 2026-09-09 (pre-release)

### 新增

- 高采样率波形管线:逐样本采样时钟、停止快照与过载降载,高码率下波形稳定不丢失
- 波形测量引擎:后端金字塔快照统计、周期检测与 AutoSet,前端测量面板完成接线
- 控件可拖拽调整大小,属性设置独立为数据面板
- 显示量程/刻度可配置(手动 / 滑动窗口自适应),注册表统一控件体系
- RawData 显示字符串域内容:字符串通道分类与值变化历史
- 工业协议采集栈:Modbus TCP / RTU 采集运行时与传输设备工厂
- 四域(波形 / 字符串 / 协议 / 诊断)统一录制与历史
- 字符串节点扩展

### 架构与性能

- 数据平面架构重设计:时钟权威、记录求值解耦、金字塔分层、路由去重
- 图求值性能:SciRS2 SIMD 批求值、chunked fork-join 并行求值、驻留 worker 屏障,重型求值移出 tokio worker
- 值平面按求值单元分区(node-lower)
- wgpu 波形包络降采样原型与可行性验证
- crate 按 `<domain>/<crate>` 分层目录重组,新增架构与依赖卫生门禁(`pnpm architecture`、`check:architecture`、`check:deps`、cargo deny)
- Rust 源码单文件 500 行上限,新增 46 个测试与 CI Rust 门禁
- 传输后端收敛到共享 trait,测试数据收敛为特殊串口(连接即生成)
- 前端移除遗留兼容层,控件配置记账收敛

### 修复

- 启动窗口空白:恢复移出主线程,首帧确认后再关闭启动页
- 高码率下摄入饿死导致的波形块状失真(显示降采样移出采集锁)
- AutoSet 适配最近 10s 窗口,修复金字塔全历史导致的时基钳死与纵向压扁
- dock 画布右侧卡片由属性面板独占

### CI

- 发布流水线重构:构建改为手动触发并自动提升版本,新增 `pnpm set-version` 一键同步前后端版本号
- Linux runner 切换至 ubuntu-26.04,修复 AppImage 打包卡死
- 移除无效 updater 配置与卡死的 rpm 打包目标

### 品牌

- 启动页与李萨如品牌标记刷新
