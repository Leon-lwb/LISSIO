# Lissio v0.7.1-rc.2 Release Notes

**Device configuration fix, plus test-data encoding and Windows export-timestamp fixes**

> This is a prerelease build on the v0.7.x line, intended for testing and feedback.
> If you are upgrading from v0.6.1 or earlier: older workspace, configuration, and persisted data formats are no longer supported or automatically migrated. Back up your existing data before upgrading; older workspaces and settings may need to be recreated.

### Fixes

- **Device and transport configuration now shows and stores the real values.** A newly created device node was written with the whole transport envelope (`{ kind, params }`) instead of the flat driver payload, so every field in the properties panel fell back to its schema default: baud rate left empty, data bits showing `5` instead of `8`, flow control and parity showing "None", while the discovered port appeared only by accident. Picking the value that was already displayed did nothing — you had to select a different value and come back. The driver also rejected that configuration, so connecting could fail, and each configuration edit closes the device session.
  - Newly created devices store the flat payload again; devices in existing projects are repaired when the workspace is loaded and the corrected configuration is written back on the next graph sync. Values you already edited and the discovered port are preserved.
  - Enum fields whose value matches no option now show an explicit "Not set" entry instead of silently displaying the first option, and numeric and text fields use the schema default as a placeholder.
- **Test data no longer emits one stale batch when its encoding changes.** Switching the generated format (for example RawData → FireWater) could still deliver one batch in the previous encoding, which the downstream protocol node then failed to parse.
- **CAN load exports no longer record a UTC timestamp on Windows.** The export filename and the `# Export Time` header were derived from a UTC fallback on Windows, so both were off by the local time-zone offset. Windows now reads the system time zone, daylight saving included, and only falls back to UTC if the system call fails.

### Also in this build

Unchanged since v0.7.0-rc.1 — the v0.7.0 feature set: independent `lissio-server` backend with browser access, server-side settings, and managed downloads; device tree panel with S7 TCP PLC and simulation child nodes; recording database browser with read-only SQL and CSV/JSON/Parquet export; refreshed AI chat interface with attachments, Markdown import/export, and a system prompt editor; CLI and MCP entry points sharing the same capability implementations. See the v0.7.0-rc.1 notes for the full description.

### Engineering

- Test-only: parallel AI host tests now use collision-free temporary paths.
- Windows-only: the serial port description module builds without lints on the `x86_64-pc-windows-msvc` target, so the workspace clippy gate passes there as well.
- Version numbers continue on the v0.7.1 patch line (bundle metadata stays `0.7.1`).

### Distribution

- Desktop: macOS `.dmg` (Apple Silicon / Intel), Linux `.deb` / `.AppImage`, and Windows `.msi` / `.exe` (NSIS).
- Deployment options also include standalone backend and Web archives, plus a container image for the server and Web frontend. Consult the release assets for available builds.

---

# Lissio v0.7.1-rc.2 发布说明

**修复设备配置读写、测试数据编码竞态与 Windows 导出时间戳**

> 本版本为 v0.7.x 线上的候选发布版，欢迎试用并反馈问题。
> 若从 v0.6.1 或更早版本升级：本版不再支持旧版工作区、配置及持久化数据格式，也不提供自动迁移。升级前请备份现有数据；旧工作区和设置可能需要重新创建。

### 修复

- **设备/传输配置现在显示并保存真实值。** 新建设备节点时写入的是整份传输信封（`{ kind, params }`）而非扁平驱动负载，导致属性面板每个字段都落到 schema 默认值：波特率留空、数据位显示 `5`（真值应为 `8`）、流控与校验位显示「无」，发现的端口只是碰巧命中才显示出来。此时「选中当前已显示的值」不生效——必须先选别的再选回来。驱动也会拒绝这份配置，因此设备可能连不上；而每次修改配置都会关闭设备会话。
  - 新建设备恢复写入扁平负载；已有工程在加载工作区时自动纠正，并在下一次图同步写回修正后的配置——你已修改的值与发现到的端口都会保留。
  - 枚举字段取值不在候选内时，显式显示「未设置」条目，不再静默回落成第一个选项；数字与文本字段用 schema 默认值作为占位提示。
- **测试数据在切换生成格式时不再多发一批旧编码数据。** 从 RawData 切到 FireWater（或反向）时，仍可能先发出一批旧格式字节，导致下游协议节点解析不出帧。
- **CAN 负载导出在 Windows 上不再记 UTC 时间戳。** 导出文件名与 CSV 头里的 `# Export Time` 之前在 Windows 走 UTC 回退，两者都比本地时间差一个时区。现在 Windows 读系统时区（含夏令时），仅在系统调用失败时才退回 UTC。

### 本版同时包含

与 v0.7.0-rc.1 相比无其他功能变化 —— 即 v0.7.0 的完整能力：可独立运行的 `lissio-server` 后端与浏览器访问、服务端设置持久化与受管文件下载；设备树面板（含西门子 S7 TCP PLC 与仿真子节点）；录制数据库浏览器（只读 SQL 与 CSV/JSON/Parquet 导出）；基于 Ant Design X 的 AI 对话界面（附件、Markdown 导入导出、系统提示词编辑器）；CLI 与 MCP 共用同一份能力实现。详细说明见 v0.7.0-rc.1 发布说明。

### 工程改进

- 仅测试相关：AI 宿主的并行用例改用不会撞名的临时路径。
- 仅 Windows 相关：串口描述模块在 `x86_64-pc-windows-msvc` 目标上不再产生 lint，Windows 侧同样能过工作区 clippy 门禁。
- 版本号沿 v0.7.1 补丁线推进（打包元数据仍为 `0.7.1`）。

### 分发形式

- 桌面安装包：macOS `.dmg`（Apple Silicon / Intel）、Linux `.deb` / `.AppImage`、Windows `.msi` / `.exe`（NSIS）。
- 同时提供独立后端与 Web 构建归档，以及服务端与 Web 前端容器镜像的部署方式。可用构建以发布附件为准。

[Full Changelog / 完整变更](https://github.com/Horldsence/Lissio/compare/v0.6.1...v0.7.1-rc.2)
