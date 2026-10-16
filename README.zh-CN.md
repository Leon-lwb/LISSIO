# Lissio

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-16
applies-to: Simplified Chinese translation of the product README; overview, setup, development, and distribution
language: zh-CN
authoritative: false
translation-of: README.md
-->

[English](README.md) · **简体中文**

> 本文件是 [`README.md`](README.md) 的简体中文译本；英文版为权威来源（English is authoritative），中英文如有出入，以英文版为准。

用 Rust + Tauri 全面重构的下一代串口助手 —— 面向嵌入式调试、波形可视化、基于节点的数据流编排、CAN / 汽车诊断与逻辑分析。

<!-- PROJECT LOGO -->
<br />

<p align="center">
  <a href="https://codeberg.org/Horldsence/Lissio">
    <img src="src-tauri/icons/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Lissio</h3>
  <p align="center">
    集波形显示、节点编辑器、多协议解析、CAN 诊断与逻辑分析于一体的现代串口调试工具。
    <br />
    <a href="https://codeberg.org/Horldsence/Lissio"><strong>浏览仓库 »</strong></a>
    <br />
    <br />
    <a href="https://codeberg.org/Horldsence/Lissio/issues">报告缺陷</a>
    ·
    <a href="https://codeberg.org/Horldsence/Lissio/issues">请求新功能</a>
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

Lissio 是面向嵌入式调试场景的桌面串口助手。前端基于 React 19 + TypeScript + Vite 构建，后端由 Rust + Tauri 2 驱动，提供高性能的传输层 I/O、协议解析、节点图 DAG 引擎、DSP（FIR/IIR 滤波器、FFT 频谱）以及汽车诊断协议（ISO-TP / UDS / OBD-II / J1939）。

应用支持 7 种传输方式、7 种协议引擎、基于 React Flow 的节点编辑器（用于数据流编排）、示波器风格波形显示、CAN 帧 / 负载分析、支持 UART/I2C/SPI 解码的逻辑分析仪，以及运行在沙箱 iframe 中的自定义 JS 控件系统。

界面采用 **停靠式窗口布局**：控制画布与数据视图以可拆分、可合并、可停靠的卡片呈现，支持多标签切换，布局自动持久化。

## 核心特性

### 传输方式

- **Serial**（USB-CDC），波特率 / 数据位 / 校验位 / 停止位 / 流控均可配置。
- **TCP Client** / **TCP Server**。
- **UDP**，本地与远端地址相互独立。
- **Test Data** —— 内置信号发生器（Sine / Square / Triangle / Sawtooth / Random / DC / Chirp / Steps / Noise / MultiTone），适合离线原型验证。
- **Slcan** —— 串口之上的 CAN。
- **CandleLight** —— 原生 USB CAN 后端。
- 自动重连与连接状态通知。

### 协议引擎

- **JustFloat** 与 **FireWater** —— 兼容 VOFA+ 的协议格式，自动识别通道。
- **RawData** —— 原始字节流查看。
- **Slcan** / **CandleLight** —— CAN 帧解析。
- **LogicDecode** —— 从采样的数字电平解码 UART / I2C / SPI。
- **Diagnostic** —— ISO-TP / UDS / OBD-II / J1939 汽车诊断协议栈（由 `libautomotive` 提供）。

### 节点编辑器与数据流

- 基于 **React Flow** —— 从侧边栏把控件拖到画布上并连线，构建数据流。
- 后端 **DAG 引擎**（`engine`）把图编译为拓扑序，逐帧计算所有节点输出，并具备环路检测。
- 节点类型：`ChannelSource`、`Input`、`Math`、`Filter`、`SpectrumSink`、`FrameDecoder`、`Custom`（JS）、`Sink`。
- **数学节点**：Add / Sub / Mul / Div / Avg / Min / Max / Abs / Neg / Square / Sqrt / Sin / Cos / Tan / Log。
- **滤波节点**：Lowpass / Highpass / Bandpass / Bandstop（FIR 系数或 IIR biquad），跨帧保持状态。
- **字符串节点**：子串操作（Mid / Left / Replace …）以及转换操作 —— **Format**（`{0:.2}` 模板 → 文本）、**Parse**（从文本中提取第一个数字，支持十进制或 0x 十六进制）、**EncodeHex** —— 双向打通波形通道与文本协议。RawData 数据源通过 `str` 端口把自身字节以 UTF-8 文本暴露出来。
- **TextOut 节点**：把图中生成的文本从任意传输方式回发出去（动态回发）。按取值变化 + 最小间隔限流；附带手动 "Send now" 按钮。
- **协议转换链**：每个 Protocol 节点都能把自己解码出的帧重新编码为另一种协议，并沿 `out` 端口推送 —— 例如 JustFloat → FireWater 再送入另一条传输；RawData 则原样透传原始字节。
- **SpectrumSink**：按数据块做 FFT，可选窗函数（Hann / Hamming / Blackman / Rect）与输出模式（Magnitude / Power / PSD / dB），由独立的 30 FPS ticker 驱动。
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
- **自定义控件编辑器** —— CodeMirror 6 驱动的 JS 编辑器，带实时预览。

### 窗口组织与布局

- **活动栏** —— 左侧 VSCode 风格图标栏，一键切换侧边栏视图（数据接口 / 协议引擎 / 控件面板）。
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
- **设置弹窗** —— 通用 / 外观 / 编辑器 / 数据 / 串口 / 通知，由所连接的后端持久化。
- **整应用配置导出 / 导入** —— 通过系统文件对话框把设置、协议、传输、控件、节点图、数据标签与视图偏好备份为单个 JSON 文件，便于迁移。
- 自定义主题编辑器、引导向导、帮助中心与上下文提示。
- 透明窗口与亚克力 / 毛玻璃效果（macOS）。
- 通过 `tauri-plugin-notification` 提供原生系统通知。
- 通过 `tauri-plugin-log` 提供结构化日志（stdout / 日志目录 / webview）。

### AI 助手

- **流式 AI 对话** —— 可停靠的对话面板（默认位于右侧；拖拽标题栏可重新停靠到左侧 / 底部或浮动，布局持久化），支持 **Markdown 渲染**（表格、代码高亮、可复制的代码块 / 消息）与多会话管理（创建 / 重命名 / 删除，历史记录在 Rust 侧持久化并跨重启保留）。
- **26+ LLM 提供商** —— OpenAI / Anthropic / Gemini / DeepSeek / Qwen / Kimi / GLM / Ollama / OpenRouter 等，默认推荐 [**OrcaRouter**](https://orcarouter.ai)（一个密钥打通所有厂商；[通过我们的推荐链接获取 API key](https://www.orcarouter.ai/ref/ref_1f7582998bdadbe7e0f3) 以支持本项目）。
- **工具调用（MCP 客户端）** —— 对话过程中模型可以调用外部 MCP 服务器（stdio / HTTP）的工具，并带有逐次调用追踪。
- **MCP 服务器（入站）** —— 应用把自身能力（串口发送、波形读取、节点图编辑…）作为 MCP 工具暴露在 `http://127.0.0.1:{port}/mcp`，让 Claude Desktop 等 MCP 客户端可以直接驱动 Lissio。

## 使用指南

### 快速开始

1. **配置传输方式** —— 点击左侧活动栏的数据接口图标，在侧边栏中选择传输方式（Serial / TCP / UDP / Test Data / Slcan / CandleLight），填写参数后点击 **Connect**。
2. **选择协议** —— 点击协议引擎图标，选择与设备匹配的协议（JustFloat / FireWater / RawData / Slcan / CandleLight / LogicDecode）。
3. **搭建数据流** —— 点击控件图标打开控件面板，把控件拖到画布上，并连到通道源或上游控件。
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

- [Rust](https://www.rust-lang.org/) + [Tauri 2](https://tauri.app/)
- [Tokio](https://tokio.rs/) —— 异步运行时
- [Serde](https://serde.rs/) —— 序列化
- [parking_lot](https://github.com/Amanieu/parking_lot) —— 同步原语
- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy) —— 亚克力 / Mica 效果
- [libautomotive](https://crates.io/crates/libautomotive) —— UDS / OBD-II / J1939 诊断
- Tauri 插件：`tauri-plugin-log`、`tauri-plugin-notification`、`tauri-plugin-opener`

### 后端工作区架构

Rust 工作区按职责领域分组，并受声明的依赖分层约束。组合根是 Tauri 外壳（`lissio`）、`backend-server` 与 `backend-cli`；产品能力通过 `control-api` 共享，命令分发通过 `rpc-api`，装配通过 `backend-host`。

| 领域 | 结构性职责 |
| --- | --- |
| `shared` | 稳定契约：错误、流信封、数据 / 配置模型、订阅 |
| `signal` | 波形缓冲区、原始数据、滤波器、频谱、测量、GPU 包络适配器 |
| `vehicle` | CAN 与诊断协议类型 |
| `protocol` | 协议 / schema 引擎、帧解码、逻辑解码、点位、采集契约 |
| `graph` | 节点定义与 HIR → plane → lower → eval 编译器 / 运行时管线 |
| `transport` | 设备树契约与串口 / 网络 / CAN / 工业协议适配器 |
| `data` | 数据总线与录制存储 |
| `ai` | LLM 客户端、对话 / 会话状态、MCP 客户端 |
| `desktop` | 管线 / 应用状态、能力核心、RPC 分发、后端 host / server / CLI、AI host、平台外壳 |

完整的 crate 清单、依赖分层、领域 DAG 与架构检查见 [`docs/architecture/crates.md`](docs/architecture/crates.md)。

## 项目结构

```text
lissio/
├── docs/architecture/             # 架构契约与设计参考
├── scripts/                       # 架构、契约、构建与发布工具
├── src/                           # React/TypeScript 前端
│   ├── components/                # 控件、显示、布局、节点、面板、AI 界面
│   ├── lib/
│   │   ├── acquisition/           # 设备树与能力投影
│   │   ├── ai/                    # 对话 / 工具的前端集成
│   │   ├── models/                # 模型目录创建 / 描述消费方
│   │   ├── platform/              # 桌面 / Web 平台服务垫片
│   │   ├── rpc/                   # 传输契约与重连 / 重水合
│   │   └── ...                    # 缓冲区、图、快速开始、协议工具
│   ├── store/                     # Zustand store 与状态切片
│   ├── types/
│   │   └── generated/             # 由 ts-rs 导出的 Rust 侧线缆契约
│   ├── i18n/locales/              # 英文与中文用户文案
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── crates/<domain>/<crate>    # Rust 工作区成员
│   ├── src/
│   │   ├── shell.rs               # 仅桌面端的窗口 / 启动画面 / 设置外壳命令
│   │   ├── sidecar.rs             # 受监管的 lissio-server 生命周期与诊断
│   │   ├── lib.rs                 # Tauri 组合根
│   │   └── main.rs
│   ├── Cargo.toml                 # 工作区与依赖权威
│   └── tauri.conf.json
├── packaging/                     # 服务启动与容器打包
├── public/                        # 静态应用资源
├── images/                        # README 资源
├── package.json
├── pnpm-workspace.yaml
└── vite.config.ts
```

## 环境要求

- [Node.js](https://nodejs.org/)（建议 LTS）
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- [Tauri 2 系统依赖](https://tauri.app/start/prerequisites/)
- CAN 诊断还需要：兼容的 CAN 接口（Slcan 适配器或兼容 CandleLight 的 USB 设备）

## 安装与运行

1. 克隆仓库

```sh
git clone https://codeberg.org/Horldsence/Lissio.git
cd lissio
```

2. 安装前端依赖

```sh
pnpm install
```

Lissio 以三个相互独立的产物交付：Backend/CLI 归档、静态 Web 归档，以及桌面安装包 —— 后者的 Tauri 外壳监管一个随包发布、版本一致的 `lissio-server` sidecar。

### 桌面端（Tauri）

```sh
pnpm dev:desktop    # 准备并启动 sidecar、Vite 与原生外壳
pnpm build:desktop  # 打包安装包 → src-tauri/target/release/bundle/
```

桌面端的业务调用一律使用 HTTP/WebSocket。Tauri IPC 仅限窗口、菜单、更新、文件对话框与 sidecar 监管。当 sidecar 缺失、未授权、版本不兼容或已经崩溃时，会在应用 store 挂载之前显示连接诊断页。

Linux/Wayland 渲染检查、设备选择器行为，以及可保留其他平台构建缓存的命令，见 [Linux 桌面渲染](docs/architecture/linux-rendering.md)。

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

暴露到 loopback 之外需要 `--bind 0.0.0.0`，并使用足够强的 `LISSIO_TOKEN`。`pnpm server` 等价于 `cd src-tauri && cargo run -p lissio-backend-server`；CLI 形式 `cargo run -p lissio-backend-cli -- serve` 复用同一代码路径。健康检查：`curl http://127.0.0.1:8790/api/v1/health`。

AI、会话、外部 MCP、入站 MCP 与前端工具命令在桌面端与 Web 端具有相同的功能面。已保存的提供商密钥是只写的：界面只会收到 `configured`、`source` 与 `writable`。部署回退变量使用 `LISSIO_AI_API_KEY_<ADAPTER>`（例如 `LISSIO_AI_API_KEY_OPENAI`）。Debug 构建在每次请求时直接从仓库根目录的 `.env` 读取这些密钥，不访问系统钥匙串。把 `.env.example` 复制为 `.env` 并在本地编辑；该文件已被 gitignore。Release 构建继续使用系统钥匙串，并以环境变量作为回退。

### OCI（服务器 + Web）

```sh
docker run --rm -p 8790:8790 -p 8765:8765 \
  -e LISSIO_TOKEN='replace-with-a-strong-token' \
  -v lissio-data:/var/lib/lissio ghcr.io/horldsence/lissio:latest
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

该命令先运行 `build:server`（server + CLI），再运行 `build:desktop`（其 Tauri 钩子只构建一次 Web 资源），最后检查原生 Windows 安装包完整性。任一步失败都会终止构建。本地桌面构建通过 `src-tauri/tauri.local.conf.json` 关闭 updater 产物，因此不需要 `TAURI_SIGNING_PRIVATE_KEY`；Release 打包通过默认 Tauri 配置保留 updater 签名。

单独构建命令：

```sh
pnpm build:web
pnpm build:server
pnpm build:cli
pnpm build:desktop
```

Web 资源输出到 `dist/`，server 与 CLI 二进制输出到 `src-tauri/target/release/`，桌面安装包输出到 `src-tauri/target/release/bundle/`。

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

本项目使用 Git 管理。可用的发布版本见 [Releases](https://codeberg.org/Horldsence/Lissio/releases) 页面。

## 许可证

Lissio 采用 **Apache License, Version 2.0** 许可；见 [LICENSE](./LICENSE)。Apache-2.0 允许商业使用、修改与闭源衍生，但须遵守其声明与署名条件。Copyright © 2026 Horldsence and Lissio contributors。贡献按 [CLA.md](./CLA.md) 提交。历史 GPL-only 版本仍受随该版本提供的许可证约束。署名与第三方义务维护在 [NOTICE](./NOTICE) 与 [docs/governance/third-party-licenses.md](docs/governance/third-party-licenses.md) 中。

欢迎贡献 —— 见 [CONTRIBUTING.md](./CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) 与 [SECURITY.md](./SECURITY.md)。

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
