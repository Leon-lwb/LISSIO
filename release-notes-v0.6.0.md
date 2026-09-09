# VOFA-NEXT v0.6.0 Release Notes

**HIGH-SAMPLING-RATE WAVEFORM PIPELINE, MEASUREMENT ENGINE, INDUSTRIAL PROTOCOL ACQUISITION, AND A RE-ARCHITECTED DATA PLANE**

> This version is a pre-release.

### ✨ New Features

**High-Sampling-Rate Waveform Pipeline**
- Per-sample sampling clock, stop snapshot, and overload shedding keep waveforms stable and loss-free at high baud rates.

**Waveform Measurement Engine**
- Backend pyramid snapshot statistics, period detection, and AutoSet, with the frontend measurement panel fully wired up.

**Widgets & Displays**
- Widgets are now resizable by dragging; property editing moved to a dedicated data panel.
- Configurable display range and scale (manual / sliding-window adaptive), backed by a unified widget registry.
- Raw Data view now shows string-domain content: string channel classification and value-change history.
- String node extensions.

**Industrial Protocol Acquisition**
- Modbus TCP / RTU acquisition runtime and transport device factory.
- Unified recording and history across four domains (waveform / string / protocol / diagnostic).

### ⚡ Architecture & Performance

- Data plane redesigned around clock authority, decoupled record evaluation, pyramidal layering, and route deduplication.
- Graph evaluation: SciRS2 SIMD batch evaluation, chunked fork-join parallel evaluation, and a resident worker barrier move heavy evaluation off the tokio executor.
- Value plane partitioned by evaluation unit (node-lower).
- wgpu waveform envelope downsampling prototype and feasibility validation.
- Crates reorganized into a `<domain>/<crate>` layered layout, with new architecture and dependency hygiene gates (`pnpm architecture`, `check:architecture`, `check:deps`, cargo deny).
- 500-line cap per Rust source file, plus 46 new tests and CI Rust gates.
- Transport backends converged on a shared trait; test data is provided by a special serial port that generates data on connect.
- Frontend legacy compatibility layers removed; widget configuration bookkeeping consolidated.

### 🐛 Bug Fixes

- Fixed the blank startup window: state restore moved off the main thread, and the splash screen now closes only after the first frame is confirmed.
- Fixed blocky waveform distortion caused by ingest starvation at high baud rates (display downsampling moved out of the acquisition lock).
- AutoSet now adapts to the most recent 10 s window, fixing timebase clamping and vertical flattening caused by full-history pyramids.
- Dock canvas right-side cards are now exclusively occupied by the property panel.

### 🔧 Engineering & CI

- Release pipeline reworked: builds are manually triggered with automatic version bumping, and the new `pnpm set-version` syncs frontend and backend versions in one step.
- Linux runner switched to ubuntu-26.04, fixing AppImage packaging hangs.
- Removed the invalid updater config and the hanging rpm packaging target.

### ⚠️ Known Issues

- When adding a connection, the port currently has to be filled in manually. This is a bug and will be fixed in the next pre-release.

### Packages
- macOS: `.dmg` (Apple Silicon / Intel)
- Linux: `.deb` / `.AppImage`
- Windows: `.msi` / `.exe` (NSIS)

---

# VOFA-NEXT v0.6.0 发布说明

**高采样率波形管线、测量引擎、工业协议采集与数据平面架构重设计**

> 本版本为预发布版。

### ✨ 新特性

**高采样率波形管线**
- 逐样本采样时钟、停止快照与过载降载，高码率下波形稳定不丢失。

**波形测量引擎**
- 后端金字塔快照统计、周期检测与 AutoSet，前端测量面板完成接线。

**控件与显示**
- 控件可拖拽调整大小，属性设置独立为数据面板。
- 显示量程/刻度可配置（手动 / 滑动窗口自适应），注册表统一控件体系。
- RawData 显示字符串域内容：字符串通道分类与值变化历史。
- 字符串节点扩展。

**工业协议采集**
- Modbus TCP / RTU 采集运行时与传输设备工厂。
- 四域（波形 / 字符串 / 协议 / 诊断）统一录制与历史。

### ⚡ 架构与性能

- 数据平面架构重设计：时钟权威、记录求值解耦、金字塔分层、路由去重。
- 图求值性能：SciRS2 SIMD 批求值、chunked fork-join 并行求值、驻留 worker 屏障，重型求值移出 tokio worker。
- 值平面按求值单元分区（node-lower）。
- wgpu 波形包络降采样原型与可行性验证。
- crate 按 `<domain>/<crate>` 分层目录重组，新增架构与依赖卫生门禁（`pnpm architecture`、`check:architecture`、`check:deps`、cargo deny）。
- Rust 源码单文件 500 行上限，新增 46 个测试与 CI Rust 门禁。
- 传输后端收敛到共享 trait，测试数据收敛为特殊串口（连接即生成）。
- 前端移除遗留兼容层，控件配置记账收敛。

### 🐛 缺陷修复

- 修复启动窗口空白：恢复移出主线程，首帧确认后再关闭启动页。
- 修复高码率下摄入饿死导致的波形块状失真（显示降采样移出采集锁）。
- AutoSet 适配最近 10s 窗口，修复金字塔全历史导致的时基钳死与纵向压扁。
- dock 画布右侧卡片由属性面板独占。

### 🔧 工程与 CI

- 发布流水线重构：构建改为手动触发并自动提升版本，新增 `pnpm set-version` 一键同步前后端版本号。
- Linux runner 切换至 ubuntu-26.04，修复 AppImage 打包卡死。
- 移除无效 updater 配置与卡死的 rpm 打包目标。

### ⚠️ 已知问题

- 新增连接时端口（port）需要手动填写，这是一个 bug，将在下一个 pre-release 中修复。

### 安装包
- macOS：`.dmg`（Apple Silicon / Intel）
- Linux：`.deb` / `.AppImage`
- Windows：`.msi` / `.exe`（NSIS）

**Full Changelog**: https://github.com/Horldsence/vofa-NEXT/compare/v0.5.0...v0.6.0
