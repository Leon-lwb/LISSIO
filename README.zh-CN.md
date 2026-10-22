# Lissio 玲思助手

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-22
applies-to: Simplified Chinese translation of the product README; overview, setup, development, and distribution
language: zh-CN
authoritative: false
translation-of: README.md
-->

[English](README.md) · **简体中文**

> 本文件是 [`README.md`](README.md) 的简体中文译本；英文版为权威来源（English is authoritative），中英文如有出入，以英文版为准。

Lissio 是面向嵌入式、车载与工业现场的数据采集与调试主机。它是同一套能力核心经由四个软件出口交付的形态 —— Tauri 桌面应用、Web 前端、MCP 服务、headless CLI —— 因此同样的采集、解码、节点图与录制行为，可以从原生窗口、浏览器、AI 客户端或脚本任意一种入口抵达。

<!-- PROJECT LOGO -->
<br />

<p align="center">
  <a href="https://codeberg.org/lissio-industries/Lissio">
    <img src="client/src-tauri/icons/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Lissio</h3>
  <p align="center">
    面向嵌入式、车载与工业现场的数据采集与调试主机。
    <br />
    <a href="https://lissio.pengheng.top"><strong>项目主页 »</strong></a>
    <br />
    <a href="https://codeberg.org/lissio-industries/Lissio"><strong>浏览仓库 »</strong></a>
    <br />
    <br />
    <a href="https://codeberg.org/lissio-industries/Lissio/issues">报告缺陷</a>
    ·
    <a href="https://codeberg.org/lissio-industries/Lissio/issues">请求新功能</a>
  </p>
</p>

![Lissio 应用示例](./images/example.png)

## 目录

- [简介](#简介)
- [核心特性](#核心特性)
- [使用指南](#使用指南)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [安装与运行](#安装与运行)
- [构建与打包](#构建与打包)
- [测试](#测试)
- [贡献](#贡献)
- [版本管理](#版本管理)
- [许可证](#许可证)
- [致谢](#致谢)

## 简介

Lissio（玲思助手）的界面由 React 19 + TypeScript + Vite 构建；实际工作运行在 `lissio-server` 这个独立的 Rust 进程里，由它拥有传输层 I/O、协议解码、节点图数据流运行时、DSP（FIR/IIR 滤波器、FFT 频谱）、CAN 与汽车诊断以及录制。桌面壳是 Tauri 2，浏览器加载同一份构建产物，两者都通过 HTTP-RPC 加 WebSocket 流式事件调用这个服务，于是桌面与 Web 是同一个能力面的两个出口。

一次会话被组织成设备树：连接节点（串口、TCP 客户端/服务端、UDP、CAN 适配器、测试数据源，以及按 Cargo feature 开关的工业协议驱动）拥有字节流，协议节点负责解码，可点选的 typed 点位再馈入 React Flow 图，图的求值结果驱动示波器风格波形、仪表、原始数据、CAN 分析、逻辑解码与自定义控件。录制把会话写入 DuckDB 支撑的数据库，同样的能力也以 MCP 工具和 CLI 子命令暴露。

界面采用 **停靠式窗口布局**：控制画布与数据视图以可拆分、可合并、可停靠的卡片呈现，支持多标签切换，布局自动持久化。

## 核心特性

### 设备树与连接

- 连接、协议引擎与测试数据源组织成一棵**设备树**；每个节点独立启用、配置与连接，无需了解线上字节格式就能定位一个 typed 点位。
- **Serial**（USB-CDC），波特率 / 数据位 / 校验位 / 停止位 / 流控均可配置，并从操作系统枚举中完成发现，带 USB VID/PID 与蓝牙 / PCI / 系统串口分类。
- **TCP Client** / **TCP Server**。
- **UDP**，本地与远端地址相互独立。
- **Test Data** —— 内置信号发生器（Sine / Square / Triangle / Sawtooth / Random / DC / Chirp / Steps / Noise / MultiTone），适合离线原型验证。
- **Slcan** —— 串口之上的 CAN；**CandleLight** —— 原生 USB CAN 后端；**CAN channel** —— 节点驱动的直接 CAN 接口。
- **工业协议驱动** —— Modbus TCP、Modbus RTU 与西门子 S7 由默认开启的 Cargo feature 提供。
- ISO-TP、UDS、OBD-II、J1939 在设备树里组成节点驱动的诊断协议栈（`libautomotive`）。
- 自动重连与连接状态通知。

### 协议解码

- 协议家族目录由后端拥有，并以描述符形式下发给客户端，携带参数、端口、能力、配置指引与示例；UI 直接渲染目录公布的每一项。JustFloat、FireWater、RawData、Slcan、CandleLight、LogicDecode 以及由帧 schema 定义的自定义协议，都是目录中的一项。
- **JustFloat** 与 **FireWater** —— 兼容 VOFA+ 的格式，自动识别通道。
- **RawData** —— 原始字节流查看；该节点通过 `str` 端口把字节以 UTF-8 文本暴露出来。
- **Slcan** / **CandleLight** —— CAN 帧解析。
- **LogicDecode** —— 从采样的数字电平解码 UART / I2C / SPI。
- **自定义 schema** —— 一份帧 schema 会编译出自己的解码引擎，并带有受限的实时**协议预览**，在提交图之前先用真实字节验证解码。
- **结构化校验** —— 每一条配置问题都带着它所归属的路径返回，于是表单能直接标出出问题的那个字段。

### 节点编辑器与数据流

- 基于 **React Flow** —— 从侧边栏把控件拖到画布上并连线，构建数据流。
- 后端 `graph` crate 把画布沿 kind → HIR → plane → lower → eval 流水线编译，确定求值顺序，并逐帧产出所有节点输出，具备环路检测。
- 节点类型：`Acquisition`、`PointSelector`、`Protocol`、`ProtocolSource`、`Input`、`Math`、`Str`、`Filter`、`Fft`、`Ifft`、`FrameDecoder`、`Trigger`、`TextInput`、`TextOut`、`TextDisplay`、`Sink`、`Custom`（JS）。
- **数学节点**：Add / Sub / Mul / Div / Avg / Min / Max / Abs / Neg / Square / Sqrt / Sin / Cos / Tan / Log。
- **滤波节点**：Lowpass / Highpass / Bandpass / Bandstop（FIR 系数或 IIR biquad），跨帧保持状态。
- **字符串节点**：子串操作（Mid / Left / Replace …）以及转换操作 —— **Format**（`{0:.2}` 模板 → 文本）、**Parse**（从文本中提取第一个数字，支持十进制或 0x 十六进制）、**EncodeHex** —— 双向打通波形通道与文本协议。RawData 数据源通过 `str` 端口把自身字节以 UTF-8 文本暴露出来。
- **TextOut 节点**：把图中生成的文本从任意传输方式回发出去（动态回发）。按取值变化 + 最小间隔限流；附带手动 "Send now" 按钮。
- **协议转换链**：每个 Protocol 节点都能把自己解码出的帧重新编码为另一种协议，并沿 `out` 端口推送 —— 例如 JustFloat → FireWater 再送入另一条传输；RawData 则原样透传原始字节。
- **Fft 节点**：按数据块做频谱分析，可选窗函数（Hann / Hamming / Blackman / Rect）与输出模式（Magnitude / Power / PSD / dB）。它在数值平面没有输出；由一个独立的 30 FPS ticker 计算数据块并发布快照，Spectrum 显示控件读取这些快照；**Ifft** 从频谱重建时域流。
- **PointSelector / Acquisition**：从设备节点挑选 typed 点位并投影到数值端口，让图跟随某一个解码字段。
- **Trigger / TextInput / TextDisplay**：边沿或命令触发的发送，以及把文本接入与接出图里的字符串平面。
- **FrameDecoder**：按数据块解析字节流（Header / Length / Id / Field / Bitfield / Checksum / Tail），通过 `match_id` 进行多帧分发并校验校验和。
- **自定义 JS 节点**：用户 JavaScript 在沙箱 iframe 中运行，输出回传至后端图。

### 操作历史 · 撤销 / 重做 / 时间旅行

- **基于快照的撤销栈** —— 画布操作（增删节点、连线、控件配置、标签管理）会自动记录到时间线；作用域为当前会话，最多 200 步。
- **快捷键** —— `Ctrl+Z` 撤销、`Ctrl+Y` 重做；节点拖拽、滑块调节等连续手势会合并为一条记录。
- **操作历史面板** —— 时间线列表最新在前，徽标按节点类型着色（连线显示双端色点）；点击任意条目即可跳回那一刻（快照回滚）。当前条目高亮，其上方条目灰显为 "已撤销 · 可重做"，点击即可重做。
- **分支语义** —— 撤销之后继续编辑会照常丢弃重做分支；导入备份或应用模板会把时间线重置到新的基线。
- **面板入口** —— 数据卡片标题栏 "＋" 菜单中的 "Open Operation History"；引导教程中也有实操演练。

### 显示与控件

- **示波器风格波形** —— 由 uPlot 驱动，支持时基缩放、光标测量、Run/Stop 冻结、通道独立 / 共享 Y 轴、缩略图缩放、十字准线、悬停点标记与光标吸附。
- **Gauge / LED / NumberDisplay / PieChart / Label** —— 一眼可读的数值展示。
- **图像查看器** —— RGB888 / RGB565 / Gray8 像素格式。
- **频谱图** —— 实时 FFT 可视化。
- **3D 模型查看器** —— 由 Three.js / React Three Fiber 驱动。
- **CAN 帧列表 / CAN 发送器 / CAN 负载视图** —— 支持 CSV 导出与负载告警。
- **逻辑时序图** + 解码事件列表（UART/I2C/SPI）。
- **命令发送器**（带块编辑器）与 **帧解码器** 手动测试面板。
- **原始数据视图** —— 独立控件，支持网格 / 行分组、HEX / ASCII 表示、按端口切换通道、时间戳 / 偏移显示与发送面板。
- **自定义控件编辑器** —— CodeMirror 6 驱动的 JS 编辑器，带实时预览；自定义控件与自定义 JS 节点都运行在沙箱 iframe 中。
- **性能监视** —— 运行中界面的实时帧开销：FPS、平均与 P95 帧耗时、长任务、JS 堆用量与监视器 RPC 延迟。

### 录制与数据历史

- **录制会话** —— DuckDB 支撑的数据库（`lissio-recording`，同时经 SeaORM 暴露实体）按通道绑定保存录制行，录制数据库面板负责会话与绑定的管理。
- **查询与导出** —— 历史按行 id 与时间范围分页，只读 SQL 在录制表上执行，导出走的正是 Web、MCP、CLI 出口调用的同一个能力。
- **随运行状态门控** —— 录制跟随工作区的 Run/Stop/Pause 状态；暂停时采集与缓存继续填充，只停止设备写入。
- **默认关闭** —— 从未主动开启的工作区不会录制任何内容，该设置由所连接的后端读取。

### 窗口组织与布局

- **活动栏** —— 左侧 VSCode 风格图标栏。上方图标切换侧边栏视图（设备树 / 快速开始 / 面板 / 录制数据库），下方同一条栏用于直接跳到某个分类，并在侧边栏打开控件目录。
- **可停靠侧边栏** —— 可停靠在窗口左右两侧；把标题栏拖到窗口边缘即可换边，并可随时显示 / 隐藏。
- **停靠式中央区域** —— 控制画布与数据视图位于可拆分 / 可合并的卡片中：
  - 把标签拖到另一张卡片的标题栏 → 合并进该卡片的标签组；
  - 把标签拖到卡片边缘 → 拆分为独立面板；
  - 拖拽标题栏空白区域 → 整张卡片移动到另一张卡片旁；
  - 把标签 / 卡片拖到页面四边 → 停靠为整行 / 整列条带。
  - 布局树与卡片尺寸自动持久化（内部持久化标识 `vofa-dock`），重启后依然保留。
- **双标签体系** —— 控制画布标签（节点编辑器）与数据标签（波形 / 原始数据 / CAN / 逻辑分析仪等）可自由混合排列。
- **状态栏** —— 连接状态、传输方式 / 协议、RX / TX 字节与帧数、CAN 负载与缓冲区用量，一目了然。
- **多标签** —— 每个标签都可独立命名、重命名、复制与关闭。

### 体验与平台

- VSCode 风格布局：活动栏、侧边栏、可调整大小的面板、状态栏、多标签。
- 原生菜单栏（macOS / Windows / Linux）与全局快捷键（`Ctrl+,` 打开设置；菜单项支持新建 / 关闭标签与切换侧边栏）。
- **i18n** —— 通过 YAML 管理中文 / 英文界面文案。
- **设置弹窗** —— 通用 / 外观 / 编辑器 / 数据 / 串口 / 通知 / 性能 / AI，以可搜索的字段描述符声明，并由所连接的后端持久化。
- **整应用配置导出 / 导入** —— 通过系统文件对话框把设置、协议、传输、控件、节点图、数据标签与视图偏好备份为单个 JSON 文件，便于迁移。
- 自定义主题编辑器、引导向导、帮助中心与上下文提示。
- 透明窗口与亚克力 / 毛玻璃效果（macOS）。
- 通过 `tauri-plugin-notification` 提供原生系统通知。
- 通过 `tauri-plugin-log` 提供结构化日志（stdout / 日志目录 / webview）。

### AI 助手

- **流式 AI 对话** —— 可停靠的对话面板（默认位于右侧；拖拽标题栏可重新停靠到左侧 / 底部或浮动，布局持久化），支持 **Markdown 渲染**（表格、代码高亮、可复制的代码块 / 消息）与多会话管理（创建 / 重命名 / 删除，历史记录在 Rust 侧持久化并跨重启保留）。
- **模型适配器** —— OpenAI（chat 与 Responses）、Anthropic、Gemini、DeepSeek、Moonshot、Z.ai、BigModel、Aliyun、OpenRouter、Groq、xAI、Ollama，以及任何 OpenAI 兼容端点，默认推荐 [**OrcaRouter**](https://orcarouter.ai)（一个密钥打通所有厂商；[通过我们的推荐链接获取 API key](https://www.orcarouter.ai/ref/ref_1f7582998bdadbe7e0f3) 以支持本项目）。已保存的密钥只写不可读：界面只知道它是否已配置、来自哪里、以及能否写入。
- **工具调用（MCP 客户端）** —— 对话过程中模型可以调用外部 MCP 服务器（stdio / HTTP）的工具，并带有逐次调用追踪。
- **MCP 服务器（入站）** —— 应用把自身能力（串口发送、波形读取、节点图编辑…）作为 MCP 工具暴露在 `http://127.0.0.1:{port}/mcp`，让 Claude Desktop 等 MCP 客户端可以直接驱动 Lissio。

### 一套核心，四个出口

- **能力核心** —— `control-api` 把设备列表、字节 / 文本 / CAN 发送、字节注入、输入值、图提交与连线编辑、波形 / 缓冲区读取、端点生命周期、运行控制、录制查询与导出实现为作用于某个状态切片的函数。每一项都带着 schemars 推导的 JSON schema 和内嵌的技能文档；MCP 路由、内置 AI 分发与技能发现都读这同一份注册表。
- **HTTP-RPC + WebSocket** —— `rpc-api` 把命令名与 JSON 参数映射到能力调用，并按连接流式回传事件。桌面与 Web 共用命令名、参数和错误；`pnpm check:web-contract` 与 `pnpm check:contracts` 保证分发表和生成的 TypeScript 不出偏差。
- **MCP 服务器** —— 同一份注册表以 streamable HTTP 上的 MCP 工具提供（默认 `127.0.0.1:8765/mcp`），Claude Desktop 或其他 MCP 客户端可以直接驱动一次真实会话。
- **CLI** —— `backend-cli` 把这些命令暴露成 argv 子命令（`devices`、`ports`、`send`、`inject`、`input`、`graph`、`data`、`snapshot`、`frame`、`endpoint`、`run`、`record`、`serve`），事件走 JSON lines，这正是 headless 运行可被脚本化的原因。
- **桌面壳** —— Tauri 负责窗口、菜单、更新器、启动屏、文件对话框与被监管的 `lissio-server` sidecar 生命周期。桌面应用的业务调用与浏览器走同一条 HTTP/WebSocket 路径。

## 使用指南

### 快速开始

1. **添加连接** —— 打开活动栏的设备树，添加一个设备（串口 / TCP / UDP / Slcan / CandleLight，或手动配置的连接），填写参数后连接。发现的端口可按名称、端口号与 USB VID/PID 搜索。
2. **解码数据流** —— 在该节点下添加协议引擎，选择与线格式匹配的协议家族（JustFloat / FireWater / RawData / Slcan / CandleLight / LogicDecode，或自定义帧 schema）。受限的实时预览会先用真实字节解码，让你先确认分帧再提交图。
3. **搭建数据流** —— 从活动栏打开控件目录，把显示控件拖到画布上，并连到协议输出、选中的设备点位或上游控件。
4. **查看数据** —— Waveform 等显示控件会自动创建对应的数据标签；也可以点击数据卡片标题栏的 "＋" 手动添加 CAN Frames、Logic Analyzer 等标签。

### 窗口组织

默认布局如下（所有面板都可自由重排）：

```
┌──────────┬──────────────────────────────────────────────┐
│          │  Control canvas card (tab bar + node editor)  │
│ Activity ├──────────────────────────────────────────────┤
│  Bar     │  Data view card (Waveform / RawData / CAN /   │
│          │  Logic / ...)                                 │
│          ├──────────────────────────────────────────────┤
│          │  Status bar: connection · transport/protocol  │
│          │  · RX/TX · load                               │
└──────────┴──────────────────────────────────────────────┘
```

- **活动栏**（最左侧竖条）—— 点击图标切换侧边栏视图；底部图标打开帮助中心、关于与设置。
- **侧边栏**（默认在左侧）—— 显示当前视图的配置面板；把标题栏拖到窗口左 / 右边缘可切换停靠侧；可通过活动栏图标或 "Toggle Sidebar" 菜单项切换显隐。
- **停靠式中央区域** —— 由卡片组成，每张卡片承载一个或多个标签：
  - **合并**：把标签拖到另一张卡片的标题栏并松开，即可合并进该卡片。
  - **拆分**：把标签拖到卡片边缘（上 / 下 / 左 / 右）并松开，即可拆分为独立面板。
  - **移动卡片**：拖拽标题栏空白区域，把整张卡片移动到另一张卡片旁。
  - **页面停靠**：把标签 / 卡片拖到窗口（中央区域）的任意边缘，停靠为整行或整列条带。
  - **调整大小**：拖拽卡片之间的分隔条改变尺寸；所有尺寸与布局都会自动保存，并在重启后恢复。
- **状态栏**（底部）—— 连接状态、当前传输方式与协议、RX / TX 字节与帧数、CAN 负载告警与缓冲区用量；右侧有刷新按钮。

### 标签管理

- **控制画布标签** —— 每个标签都是独立的节点编辑器画布。点击标题栏的 "＋" 新建；右键标签可重命名 / 复制 / 关闭 / 关闭其他；双击标签文字可直接重命名。
- **数据标签** —— Waveform、Raw Data、Pie Chart、Image、3D Model、Spectrum、Command Sender、CAN Frames、Logic Analyzer、Table View、Frame Decoder 等。数据卡片标题栏的 "＋" 可添加 CAN Frames 与 Logic Analyzer 标签。
- 标签可在卡片之间自由拖拽以合并 / 拆分，也可通过右键菜单关闭。

### 常用操作

- **设置**：`Ctrl+,` / `Cmd+,` 或活动栏中的齿轮图标；支持整应用配置导出 / 导入（备份为单个 JSON 文件）。
- **撤销与时间旅行**：`Ctrl+Z` 撤销、`Ctrl+Y` 重做；点击操作历史面板中的任意条目即可跳回那一刻（见核心特性）。
- **刷新端口**：状态栏中的刷新按钮或右键菜单。
- **帮助与引导**：活动栏底部的帮助图标可随时打开帮助中心；首次启动会显示引导教程。关闭或完成后不再自动提醒；帮助中心可随时重放。设置读写失败时会提供重试操作。

## 技术栈

### 前端

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite 7](https://vitejs.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/)（通过 `@tailwindcss/vite`）
- [React Flow](https://reactflow.dev/)（`@xyflow/react`）—— 节点编辑器
- [uPlot](https://github.com/leeoniya/uPlot) —— 波形图
- [Three.js](https://threejs.org/) + [`@react-three/fiber`](https://github.com/pmndjs/react-three-fiber) —— 3D 查看器
- [CodeMirror 6](https://codemirror.net/) —— 自定义控件代码编辑器
- [TanStack React Virtual](https://tanstack.com/virtual) —— 虚拟化列表
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) —— VSCode 风格布局
- [Zustand](https://github.com/pmndrs/zustand) —— 状态管理
- [lucide-react](https://lucide.dev/icons/) —— 图标
- [YAML](https://github.com/eemeli/yaml) —— i18n

### 后端

- [Rust](https://www.rust-lang.org/) —— `lissio-server`，所有出口共同调用的进程
- [Tokio](https://tokio.rs/) —— 异步运行时；[axum](https://github.com/tokio-rs/axum) —— HTTP-RPC 与 WebSocket 传输
- [Serde](https://serde.rs/) + [schemars](https://crates.io/crates/schemars) —— 能力 DTO，以及 MCP 路由与内置 AI 共同推导的 JSON schema
- [ts-rs](https://crates.io/crates/ts-rs) —— 生成 `client/src/types/generated` 的 Rust 侧线缆类型
- [rmcp](https://crates.io/crates/rmcp) —— 入站 MCP streamable-HTTP 服务器；`mcp-client` crate 负责向外连接其他 MCP 服务器
- [clap](https://github.com/clap-rs/clap) —— `backend-cli` 子命令
- [DuckDB](https://crates.io/crates/duckdb) + [SeaORM](https://github.com/SeaQL/sea-orm) —— `lissio-recording` 背后的录制存储
- [libautomotive](https://crates.io/crates/libautomotive) —— UDS / OBD-II / J1939 诊断
- [parking_lot](https://github.com/Amanieu/parking_lot) —— 同步原语

### 桌面外壳

- [Tauri 2](https://tauri.app/) —— 窗口、菜单、更新器、启动屏、文件对话框与 sidecar 监管
- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy) —— 亚克力 / Mica 效果
- Tauri 插件：`tauri-plugin-log`、`tauri-plugin-notification`、`tauri-plugin-opener`

### 后端工作区架构

Rust 侧是四个 Cargo 工作区：`server/` 以及嵌套在它下面的 `core/`、`physical/`、`data/` 工作区，每个都有自己的 lockfile 与自己发布的 crate。每个成员都在 `[package.metadata.lissio]` 里声明自己的领域、依赖分层与职责，`pnpm check:architecture` 会读取全部四份清单来强制领域 DAG 与分层规则。组合根是 `backend-server`、`backend-cli` 与 Tauri 外壳（`lissio`）；产品能力通过 `control-api` 共享，命令分发通过 `rpc-api`，装配通过 `backend-host`，每个组合根都复用它。

| 领域 | 所属工作区 | 结构性职责 |
| --- | --- | --- |
| `shared` | `core` | 稳定契约：错误、流信封、数据 / 配置模型、订阅 |
| `vehicle` | `core` | CAN 与诊断协议类型 |
| `protocol` | `core`、`physical` | `core` 里的协议注册表与 schema、帧解码、逻辑解码、点位；`physical` 里的采集与仿真引擎 |
| `transport` | `physical` | 设备树装配，以及串口 / 网络 / CAN / Modbus / S7 适配器 |
| `signal` | `data` | 波形缓冲区、原始数据、滤波器、频谱、测量、GPU 包络适配器 |
| `graph` | `data` | 节点定义与 kind → HIR → plane → lower → eval 编译器 / 运行时管线 |
| `data` | `data` | 数据总线、`dataflow` 门面与录制存储 |
| `ai` | `server` | LLM 客户端、对话 / 会话状态、MCP 客户端 |
| `desktop` | `server` | 管线 / 应用状态、能力核心、RPC 分发、后端 host / server / CLI、AI host、平台外壳 |

完整的 crate 清单、依赖分层、领域 DAG 与架构检查见 [`server/docs/architecture/crates.md`](server/docs/architecture/crates.md)。

## 项目结构

```text
lissio/                            # 伞仓库：仅承载跨仓库基础设施
├── .changes/                      # 由 pnpm release:prepare 消费的发布变更文件
├── .forgejo/workflows/            # CI 与发布工作流（递归检出子模块）
├── docs/                          # 架构、治理、性能与评审记录
├── e2e/                           # 驱动 Web 产物与真实服务端的 Playwright 套件
├── packaging/                     # 服务启动与容器打包
├── scripts/                       # 架构、契约、构建与发布工具
├── client/                        # 前端仓库（子模块）
│   ├── src/                       # React/TypeScript 前端
│   │   ├── components/            # 控件、显示、布局、节点、面板、AI 界面
│   │   ├── lib/                   # 采集、AI、模型、平台、rpc 与工具
│   │   ├── store/                 # Zustand store 与状态切片
│   │   ├── types/generated/       # 由 ts-rs 导出的 Rust 侧线缆契约
│   │   ├── i18n/resources/        # en/ 与 zh/ 的 YAML 用户文案，按界面切分文件
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/                    # 静态应用资源
│   ├── src-tauri/                 # Tauri 2 桌面外壳
│   │   ├── src/                   # shell.rs、sidecar.rs、lib.rs、main.rs
│   │   ├── crates/                # 仅外壳使用的 crate（菜单外壳、更新流程）
│   │   └── tauri.conf.json
│   ├── vite.config.ts
│   └── package.json               # 前端依赖与脚本
├── server/                        # Rust 仓库（子模块）：Cargo 工作区根
│   ├── crates/<domain>/<crate>    # 由 server 仓库自有的 crate
│   ├── core/                      # core 子模块：shared、vehicle 与 protocol 契约
│   ├── physical/                  # physical 子模块：传输适配器、采集与仿真
│   ├── data/                      # data 子模块：graph、signal 与 data crate
│   ├── tests/                     # 集成测试
│   ├── Cargo.toml                 # 工作区与依赖权威
│   └── deny.toml
├── images/                        # README 资源
├── package.json                   # 伞仓库编排清单
├── pnpm-workspace.yaml
├── playwright.config.ts
└── Dockerfile
```

## 环境要求

- [Node.js](https://nodejs.org/)（建议 LTS）
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- [Tauri 2 系统依赖](https://tauri.app/start/prerequisites/)
- CAN 诊断还需要：兼容的 CAN 接口（Slcan 适配器或兼容 CandleLight 的 USB 设备）

## 安装与运行

1. 克隆仓库并检出子模块

`client/` 与 `server/` 是分开的仓库，`server/` 之下又嵌套了 `core/`、`physical/` 与 `data/`，因此一份可用的检出需要包含全部层级。

```sh
git clone --recurse-submodules https://codeberg.org/lissio-industries/Lissio.git
cd Lissio

# 或者，在一个普通克隆里
git submodule update --init --recursive
```

2. 安装前端依赖

```sh
pnpm install
```

Lissio 以三个产物支撑四个出口：装着 `lissio-server` 与 `backend-cli` 两个二进制的 Backend/CLI 归档、静态 Web 归档，以及桌面安装包 —— 后者的 Tauri 外壳监管一个随包发布、版本一致的 `lissio-server` sidecar。MCP 出口运行在 `lissio-server` 内部。

### 桌面端（Tauri）

```sh
pnpm dev:desktop    # 准备并启动 sidecar、Vite 与原生外壳
pnpm build:desktop  # 打包安装包 → client/src-tauri/target/release/bundle/
```

桌面端的业务调用一律使用 HTTP/WebSocket。Tauri IPC 仅限窗口、菜单、更新、文件对话框与 sidecar 监管。当 sidecar 缺失、未授权、版本不兼容或已经崩溃时，会在应用 store 挂载之前显示连接诊断页。

Linux/Wayland 渲染检查、设备选择器行为，以及可保留其他平台构建缓存的命令，见 [Linux 桌面渲染](client/docs/architecture/linux-rendering.md)。

### 独立 Web 服务器（`lissio-server`）

```sh
pnpm build:web                              # 前端 → dist/
pnpm dev:server --static-dir dist           # HTTP API + Web 应用同进程运行
```

然后打开 `http://127.0.0.1:8790`。首次访问时以 `?token=<server-token>` 形式附加访问令牌 —— 浏览器会把它保存在 sessionStorage 中，并立即从地址栏移除该参数。令牌文件在首次启动时创建，其路径会打印到服务器日志：`~/Library/Application Support/top.pengheng.lissio/server-token`（macOS）、`%APPDATA%\top.pengheng.lissio\server-token`（Windows）、`~/.config/top.pengheng.lissio/server-token`（Linux）。你也可以显式设置 `LISSIO_TOKEN`。

| 参数 | 环境变量 | 默认值 |
|---|---|---|
| `--bind` | `LISSIO_BIND` | `127.0.0.1` |
| `--http-port` | `LISSIO_HTTP_PORT` | `8790` |
| `--token` / `--token-file` | `LISSIO_TOKEN` | `<config dir>/server-token`（0600） |
| `--static-dir` | `LISSIO_STATIC_DIR` | 关闭（仅 API） |
| `--cors-origin`（可重复） | `LISSIO_CORS_ORIGINS` | 关闭（同源） |
| `--mcp-port` / `--no-mcp` | `LISSIO_MCP_PORT` | `8765` / 启用 MCP |

暴露到 loopback 之外需要 `--bind 0.0.0.0`，并使用足够强的 `LISSIO_TOKEN`。`pnpm server` 等价于 `cargo run --manifest-path server/Cargo.toml -p lissio-backend-server`；CLI 形式 `cargo run -p lissio-backend-cli -- serve` 复用同一代码路径。健康检查：`curl http://127.0.0.1:8790/api/v1/health`。

AI、会话、外部 MCP、入站 MCP 与前端工具命令在桌面端与 Web 端具有相同的功能面。已保存的提供商密钥是只写的：界面只会收到 `configured`、`source` 与 `writable`。部署回退变量使用 `LISSIO_AI_API_KEY_<ADAPTER>`（例如 `LISSIO_AI_API_KEY_OPENAI`）。Debug 构建在每次请求时直接从仓库根目录的 `.env` 读取这些密钥，不访问系统钥匙串。把 `.env.example` 复制为 `.env` 并在本地编辑；该文件已被 gitignore。Release 构建继续使用系统钥匙串，并以环境变量作为回退。

### OCI（服务器 + Web）

```sh
docker run --rm -p 8790:8790 -p 8765:8765 \
  -e LISSIO_TOKEN='replace-with-a-strong-token' \
  -v lissio-data:/var/lib/lissio ghcr.io/lissio-industries/lissio:latest
```

镜像在没有显式令牌时拒绝启动。需要硬件访问时，用容器运行时的设备选项映射串口 / CAN 设备。

### Web 前端开发（热重载）

```sh
pnpm dev:server # 终端 1：独立后端，监听 :8790
pnpm dev:web   # 终端 2：vite dev server，监听 :1420，/api 代理到后端
```

首次访问 `http://localhost:1420/?token=<server-token>`（令牌会保存在 sessionStorage 中）。用 `LISSIO_DEV_SERVER=http://host:port` 可把代理指向其他后端。

## 构建与打包

为当前平台构建服务器、CLI、桌面端与 Web：

```sh
pnpm build:all
```

该命令先运行 `build:server`（server + CLI），再运行 `build:desktop`（其 Tauri 钩子只构建一次 Web 资源），最后检查原生 Windows 安装包完整性。任一步失败都会终止构建。本地桌面构建通过 `client/src-tauri/tauri.local.conf.json` 关闭 updater 产物，因此不需要 `TAURI_SIGNING_PRIVATE_KEY`；Release 打包通过默认 Tauri 配置保留 updater 签名。

单独构建命令：

```sh
pnpm build:web
pnpm build:server
pnpm build:cli
pnpm build:desktop
```

Web 资源输出到 `client/dist/`，server 与 CLI 二进制输出到 `server/target/release/`，桌面安装包输出到 `client/src-tauri/target/release/bundle/`。

在 Windows 上，`build:all` 最后会执行 `scripts/finalize-bundles.mjs`：检查现有 `bundle/nsis/` 与 `bundle/msi/` 目录中当前版本的安装包，把 Low 完整性标签提升为 Medium，并校验 SHA256 未发生变化。即使 Temp 目录正常，Low 完整性的 EXE 也可能让 NSIS 报 "Error writing temporary file"。安装包路径固定在工作树内；没有单独的导出命令或目标目录设置。若完整性检查失败，请在沙箱之外的普通 Windows 终端中运行 `pnpm build:all`。macOS 与 Linux 会跳过这个 Windows 专属步骤，保留 Tauri 常规的打包输出。

在 macOS 主机上，自动化打包脚本覆盖跨目标构建、updater 签名与产物收集：

```sh
pnpm auto-build              # 当前 macOS 架构（需要 macOS 主机）
pnpm auto-build --all        # macOS（arm64 + x64）、Windows、Linux
```

如需直接驱动 Tauri，例如只构建单个 bundle：

```sh
# Windows 交叉编译
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc

# macOS dmg 包
pnpm tauri build --bundles dmg
```

CI 运行在 Codeberg 上，使用 Forgejo Actions，配置位于 `.forgejo/workflows/`（`ci.yml` 负责质量门禁，`release.yml` 负责发布）。门禁清单只在 `scripts/gates.mjs` 中定义一次。运行器搭建、门禁注册表与发布流水线见 [`docs/ci.md`](docs/ci.md)。

## 测试

用一条命令跑完与 CI 相同的质量面：

```sh
pnpm check:all          # 全部检查，并修复格式
pnpm check:all --quick  # 仅 PR 层门禁
pnpm gates --list       # 打印门禁清单
```

各项门禁列在 [`AGENTS.md`](AGENTS.md#commands) 中；该清单由 `scripts/gates.mjs` 生成，CI 与 `pnpm check:all` 都读取它。局部通过不等于整体通过。

## 贡献

贡献正是开源社区得以学习、启发与创造的原因。你的任何贡献都**深受欢迎**。

1. Fork 本项目
2. 创建特性分支：`git checkout -b feature/AmazingFeature`
3. 提交改动：`git commit -m 'Add some AmazingFeature'`
4. 推送到分支：`git push origin feature/AmazingFeature`
5. 发起 Pull Request

请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)：其中列出了 CLA 条款、你的改动必须满足的知识产权检查，以及完整的门禁清单（`pnpm check:all`）。

## 版本管理

本项目使用 Git 管理。可用的发布版本见 [Releases](https://codeberg.org/lissio-industries/Lissio/releases) 页面。

## 许可证

Lissio 采用 **Apache License, Version 2.0** 许可；见 [LICENSE](./LICENSE)。Apache-2.0 允许商业使用、修改与闭源衍生，但须遵守其声明与署名条件。Copyright © 2026 Horldsence and Lissio contributors。贡献按 [CLA.md](./CLA.md) 提交。历史 GPL-only 版本仍受随该版本提供的许可证约束。署名与第三方义务维护在 [NOTICE](./NOTICE) 与 [docs/governance/third-party-licenses.md](docs/governance/third-party-licenses.md) 中。

欢迎贡献 —— 见 [CONTRIBUTING.md](./CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) 与 [SECURITY.md](./SECURITY.md)。许可与治理问题请联系 [pengheng.wang@foxmail.com](mailto:pengheng.wang@foxmail.com)；维护者与响应时限见 [MAINTAINERS.md](./MAINTAINERS.md)。

## 致谢

- [VOFA+](https://www.vofa.plus/) 提供 FireWater / JustFloat 兼容协议的参考
- [Tauri](https://tauri.app/)
- [React Flow](https://reactflow.dev/)
- [uPlot](https://github.com/leeoniya/uPlot)
- [Three.js](https://threejs.org/) / [React Three Fiber](https://github.com/pmndjs/react-three-fiber)
- [CodeMirror](https://codemirror.net/)
- [Tailwind CSS](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/)
- [libautomotive](https://crates.io/crates/libautomotive)

<!-- links -->
