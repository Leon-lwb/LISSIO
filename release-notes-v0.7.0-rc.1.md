# Lissio v0.7.0-rc.1 Release Notes

**Independent backend, browser access, device trees, and a more complete recording workflow**

> This is the first release candidate for v0.7.0, intended for testing and feedback.
> Older workspace, configuration, and persisted data formats are no longer supported or automatically migrated. Back up your existing data before upgrading; older workspaces and settings may need to be recreated.

### Desktop, Web, CLI, and MCP

- Run the backend independently with `lissio-server` and access the application in a browser. HTTP-RPC and WebSocket connections support authentication, live data subscriptions, and automatic reconnection.
- The desktop application now launches and supervises a separate backend process. Desktop and browser clients share the same backend capabilities, with an improved startup connection screen and desktop connection fixes.
- Use the headless CLI for device discovery, graph operations, data inspection, acquisition control, and recording. CLI, MCP, and the built-in AI share the same capability implementations.
- Browser access now includes server-side settings persistence and managed file downloads, including waveform and CAN load CSV exports.

### Devices and Acquisition

- New device tree panel for browsing, searching, and configuring device hierarchies, with protocol and simulation child nodes and runtime status inspection.
- Added Siemens S7 TCP PLC acquisition support.
- Improved CAN frame browsing with a latest-frame view grouped by CAN ID.
- Fixed the 1 Mbps CAN bitrate mismatch between the frontend and SLCAN/CANable backends.

### Recording and History

- New recording database browser with session summaries, filtered history, read-only SQL queries, and CSV, JSON, and Parquet exports.
- Create recording sessions or switch the active recording target while acquisition is paused.
- Startup recording sessions begin paused, and the newest empty session is reused to avoid accumulating empty sessions after repeated restarts.
- Recording storage options are now available in the Data settings category.
- Fixed history cleanup for recorded batches and added recovery for certain DuckDB catalog damage caused by interrupted schema changes, retaining the damaged database as a backup.

### AI and Interface

- Refreshed the AI chat interface with Ant Design X.
- Attach text files to chat messages through file selection or drag and drop; attachments are saved with the session.
- Export conversations as Markdown and import Markdown into the message input. A dedicated system prompt editor provides source and preview views, plus Markdown import and export.
- Unified search inputs, smoother Raw Data auto-scrolling, Raw Data display fixes, and improved Chinese font defaults and fallbacks.

### Engineering

- Rust wire types now generate frontend TypeScript contracts, with consistency checks for contracts and the model catalog.
- Built-in AI and MCP tools and skills are derived from a shared capability registry, reducing differences between entry points.
- Expanded architecture checks and performance benchmark tooling; added a crates.io publishing pipeline for the `lissio-*` packages.

### Distribution

- Desktop: macOS `.dmg` (Apple Silicon / Intel), Linux `.deb` / `.AppImage`, and Windows `.msi` / `.exe` (NSIS).
- Deployment options also include standalone backend and Web archives, plus a container image for the server and Web frontend. Consult the release assets for available builds.

---

# Lissio v0.7.0-rc.1 发布说明

**独立后端与浏览器访问、设备树，以及更完整的录制管理体验**

> 本版本为 v0.7.0 的首个候选发布版，欢迎试用并反馈问题。
> 本版不再支持旧版工作区、配置及持久化数据格式，也不提供自动迁移。升级前请备份现有数据；旧工作区和设置可能需要重新创建。

### 桌面、Web、CLI 与 MCP

- 后端可通过 `lissio-server` 独立运行，并在浏览器中访问应用。HTTP-RPC 与 WebSocket 连接支持鉴权、实时数据订阅和断线自动重连。
- 桌面应用改为启动并监管独立后端进程，桌面与浏览器共用后端能力；改进启动连接界面，并修复桌面连接问题。
- 无界面 CLI 支持设备发现、图操作、数据查看、采集控制及录制管理。CLI、MCP 与内置 AI 共用能力实现。
- 浏览器端新增服务端设置持久化与受管文件下载，支持波形和 CAN 负载 CSV 导出。

### 设备与采集

- 新增设备树面板，可浏览、搜索和配置设备层级，添加协议与仿真子节点，并查看运行状态。
- 新增西门子 S7 TCP PLC 采集支持。
- 改进 CAN 帧浏览，新增按 CAN ID 聚合的最新帧视图。
- 修复前端与 SLCAN/CANable 后端之间 1 Mbps CAN 波特率不匹配的问题。

### 录制与历史数据

- 新增录制数据库浏览器，支持会话概览、历史数据筛选、只读 SQL 查询，以及 CSV、JSON、Parquet 导出。
- 采集暂停时可新建录制会话或切换当前写入目标。
- 启动时录制会话默认处于暂停状态，并复用最近的空会话，避免反复重启产生大量空记录。
- 在「数据」设置分类中开放录制存储选项。
- 修复已有录制批次的历史清理问题；针对中断表结构变更导致的部分 DuckDB 目录损坏，新增恢复处理并保留损坏数据库备份。

### AI 与界面体验

- 基于 Ant Design X 更新 AI 对话界面。
- 支持通过文件选择或拖拽为消息添加文本附件，附件随会话保存。
- 支持将对话导出为 Markdown，并将 Markdown 导入消息输入框；新增独立系统提示词编辑器，提供源码、预览及 Markdown 导入导出。
- 统一搜索输入框，优化原始数据自动滚动，修复原始数据显示问题，并调整中文字体默认值与回退策略。

### 工程改进

- 从 Rust 传输类型生成前端 TypeScript 契约，并增加契约与模型目录一致性检查。
- 内置 AI 与 MCP 的工具及技能由统一能力注册表生成，减少不同入口之间的行为差异。
- 完善架构检查与性能基准工具，新增 `lissio-*` 包的 crates.io 发布流水线。

### 分发形式

- 桌面安装包：macOS `.dmg`（Apple Silicon / Intel）、Linux `.deb` / `.AppImage`、Windows `.msi` / `.exe`（NSIS）。
- 同时提供独立后端与 Web 构建归档，以及服务端与 Web 前端容器镜像的部署方式。可用构建以发布附件为准。

[Full Changelog / 完整变更](https://github.com/Horldsence/Lissio/compare/v0.6.1...v0.7.0-rc.1)
