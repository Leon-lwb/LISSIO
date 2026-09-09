# VOFA-NEXT v0.6.1 Release Notes

**RICH SERIAL PORT DISCOVERY, ONE-CLICK DEFAULT CANVAS, AND A CATEGORIZED WIDGET PALETTE**

> This version is a pre-release.

### ✨ New Features

**Serial Port Discovery**
- Port enumeration now carries rich metadata: port type (USB / PCI / Bluetooth), USB VID/PID, serial number, manufacturer, and product name.
- Per-platform enrichment pipeline: deep port metadata on macOS, friendly descriptions on Windows, and normalized enumeration on Linux.
- Fixes the v0.6.0 known issue where the port had to be filled in manually when adding a connection.

**Acquisition Device Panel**
- New device panel with a discovered-endpoint list and device discovery hook, so available serial endpoints are presented for selection instead of typed by hand.
- Schema field labels localized (zh / en).

**Default Canvas Workflow**
- One-click default canvas: automatically creates a Serial → JustFloat → RawData pipeline with a Raw Data widget, selects the serial node, and opens its property panel.
- Startup seeding is now async-safe: it no longer duplicates nodes or overwrites a restored workspace.

**Navigation & Widget Palette**
- Widget palette rebuilt as a categorized catalog (connection / processing / display / extension), with category entries in the activity bar replacing the old jump bar.
- Sidebar navigation and active-state styling refined.

### 🔧 Engineering & CI

- New three-platform (Linux / Windows / macOS) serial discovery contract tests in the lint workflow (`serial`, `modbus-adapter`, `can-transport`).
- Release pipeline fix: the release workflow now accepts a build run whose head commit is an ancestor of the release commit, covering the automatic version-bump commit pushed by the build.
- Expanded zh / en locale coverage and new frontend tests (device discovery, category palette, sidebar, initial graph).

### Packages
- macOS: `.dmg` (Apple Silicon / Intel)
- Linux: `.deb` / `.AppImage`
- Windows: `.msi` / `.exe` (NSIS)

---

# VOFA-NEXT v0.6.1 发布说明

**串口发现元数据、一键默认画布与分类控件面板**

> 本版本为预发布版。

### ✨ 新特性

**串口发现**
- 串口枚举携带丰富元数据：端口类型（USB / PCI / 蓝牙）、USB VID/PID、序列号、厂商与产品名。
- 分平台补全管线：macOS 深度端口信息、Windows 友好描述、Linux 归一化枚举。
- 修复 v0.6.0 已知问题：新增连接时端口不再需要手动填写。

**采集设备面板**
- 新增设备面板与发现端点列表，配合设备发现 hook，可用串口端点直接选择，无需手工输入。
- Schema 字段标签中/英双语。

**默认画布工作流**
- 一键默认画布：自动创建 Serial → JustFloat → RawData 管线与 Raw Data 控件，选中串口节点并打开属性面板。
- 启动播种改为异步安全：不再重复建节点，也不会覆盖已恢复的工作区。

**导航与控件面板**
- 控件面板重构为分类目录（连接 / 处理 / 展示 / 扩展），活动栏分类入口替代原跳转条。
- 侧边栏导航与选中态样式优化。

### 🔧 工程与 CI

- lint 工作流新增三平台（Linux / Windows / macOS）串口发现契约测试（`serial`、`modbus-adapter`、`can-transport`）。
- 发布流水线修复：release 校验允许构建运行的 head 提交为发布提交的祖先，覆盖构建自动推送的 version bump 提交。
- 扩充中英文案与前端测试（设备发现、分类面板、侧边栏、初始图）。

### 安装包
- macOS：`.dmg`（Apple Silicon / Intel）
- Linux：`.deb` / `.AppImage`
- Windows：`.msi` / `.exe`（NSIS）

**Full Changelog**: https://github.com/Horldsence/Lissio/compare/v0.6.0...v0.6.1
