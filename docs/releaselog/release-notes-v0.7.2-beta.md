# Lissio v0.7.2-beta Release Notes

**A pause that keeps recording, one liveness rule for every panel, and a steadier Raw Data view**

> This is a beta build on the v0.7.x line, intended for testing and feedback.
> If you are upgrading from v0.6.1 or earlier: older workspace, configuration, and persisted data formats are no longer supported or automatically migrated. Back up your existing data before upgrading; older workspaces and settings may need to be recreated.

### Pause and stop are now different things

- **Pause no longer throws data away.** It keeps the connection and the acquisition path running: bytes are still parsed and written into the waveform / raw data / CAN / logic buffers and into the recording database, and graph evaluation continues. Only automatic sending and device writes stop.
  - Recording keeps writing to the database while paused, and the session state reflects the actual writes. Swapping the recorder takes the execution-boundary write lock, so a batch can never land in a window where the recorder is missing.
  - Resuming from pause keeps the data continuous: stream sequences are not rebuilt and protocol parsers and transient state are not reset.
  - The status bar shows **Recording** next to the run button while the workspace is paused but still writing.
- **Stop is still the hard gate.** In-flight data is dropped and never enters any cache; existing caches are kept. A `pause` while stopped is a no-op.

### One rule decides whether a panel is live

- A live display is now derived in a single place: **live = the workspace is running and the panel is following the latest**. Panels no longer each carry their own freeze logic.
- A non-live panel gets a **Not live** badge (warning colour and icon) plus a warning-coloured outline around the panel content. The outline only draws a border — the panel keeps its own data colours — and it never intercepts pointer events.
- A panel counts as non-live both when the workspace is paused or stopped and when the user dragged that panel away from the latest (waveform horizontal delay > 0, list scrolled up, auto-scroll turned off).
- Resuming from pause broadcasts one "go to latest": the waveform resets its horizontal delay and follows live again, and the raw data / CAN / logic lists restore auto-scroll and jump to the end — resuming lands on the latest state instead of continuing from the frozen frame.

### Scrolling up pauses the workspace

- Scrolling up in the raw data / CAN / logic event lists now actually pauses the workspace, reference-counted per card. The wiring was missing before: the scroll-pause coordinator existed as pure logic with nothing attached to it, and the high-speed auto-scroll overrode wheel input so the viewport could not even detach.
- Only a deliberate user scroll up (wheel up, touch drag, scrollbar drag) triggers the pause — a viewport that is merely not at the bottom does not.
- Resuming is explicit: the **Back to latest** button, or re-enabling auto-scroll (including the go-live broadcast when a pause resumes). Landing at the bottom by chance does not auto-resume, and a panel that was started or stopped manually is not started again automatically.

### Raw Data panel

- **Refresh no longer flickers.** Auto-scroll now advances continuously frame by frame and only jumps to the bottom when catching up is meaningless (more than 20000 px behind). The grid row origin is aligned to the absolute byte stream, so rows no longer shift by a column after the ring buffer wraps — the same absolute byte stays in the same column between frames.
- Scroll events that WebKit dispatches asynchronously no longer look like "the user took over": recent programmatic writes are compared against the reported offset, so following no longer stops halfway.
- A **Back to latest** button appears in the bottom-right corner once you scroll away; the auto-scroll button shows an inactive state while detached.
- Row view overflow is fixed, and the auto-scroll button's active state now tracks a reactive detached flag instead of a mutable ref.
- Long lines are capped: a single row wraps after 64 bytes instead of letting an entire newline-free chunk become one row, and the wrap point falls back to a UTF-8 sequence start so multi-byte characters are never cut into replacement characters. Continuation rows are marked, and copying them does not insert a newline.

### Fixes

- **Right-click works while the workspace is running.** The context menu closed itself on *any* `scroll` event captured at the window, and a running data panel writes `scrollTop` every frame to follow the latest data — so the menu was torn down in the same frame it opened, before it was ever painted, while `preventDefault` had already suppressed the native menu. Only a scroll of the viewport itself closes the menu now; element-level scrolling no longer affects it, and surfaces that define no menu items no longer swallow the event either (a data card's tab bar used to show nothing at all).
- **The history database page no longer shows `[object Object]`.** Transport failures reject with a plain `RpcError { kind, message }` object rather than an `Error`, and the recording store formatted it with `String(...)` before rendering it in the panel's error bar. A single `errorText` helper now resolves user-facing text for `Error` / strings / `{ kind, message }` (falling back to JSON only when there is no message), `formatError` reuses it, and the same pattern was collapsed onto it across the stores, connection gate and display panels.
- **Normal backpressure no longer stops acquisition.** A full writer queue used to be classified as a writer fault, and that flag stuck until the recorder was replaced — so after one transient burst, every *Start* was pushed back to *Stopped* within a batch ("a few characters out, Pause never releases"). Only batches that were accepted but cannot be persisted count as a fault now, a successful write clears it, and the queue is much larger so a checkpoint or antivirus stall is absorbed.
- **A recording writer that stops answering can no longer freeze the app.** Control round-trips (session state, bindings, flush, maintenance, shutdown) are bounded on both the send and the reply side — 5 s for run control, 10 s for shutdown, 120 s for flush / session deletion. A writer that does not answer is detached and reported as *unavailable* instead of blocking the acquisition hot path or the run controls, and the execution-boundary write lock taken while swapping the recorder is released after 30 s no matter what.
- **Recording can now be switched off at runtime.** A new **Recording database** switch (Settings → Data, default on) closes the recorder and releases the DuckDB file handle immediately — at any run state — and reopens it when switched back on. Existing database files and history are never deleted. This is the escape hatch when the database is what is hanging on Windows; the recording panel and its views grey out and explain why instead of showing a failure.
- **Concurrent instances can no longer corrupt recorded history, and opening can no longer hang.** Queries, exports, session checks, history paging and read-only SQL now all run on the writer's single DuckDB connection instead of each opening its own instance — multiple instances checkpoint over each other and silently erase committed writes.
  - Opening is pre-flighted and bounded: an existing database file is probed for a mandatory lock, and the open itself runs with a 30-second ceiling, so a database held by another process fails fast and is reported as *unavailable* instead of blocking the app.
  - Opening also validates: if the catalog is damaged the database is rebuilt automatically through the existing repair path and recording continues; the panel says so, and it is reported as a notice rather than a failure (a failure would stop acquisition).
- **A locked recording database no longer stops acquisition.** When the database cannot be opened (for example another instance holds a mandatory lock on the file on Windows), recording is reported as *unavailable* instead of as a writer fault, so acquisition keeps running without recording instead of being blocked.
  - A process-level lock file next to the database makes a second instance fail fast instead of letting two DuckDB writers checkpoint over each other and silently erase committed data.
- **A supervised backend now exits within a bounded time.** A teardown that hangs kept the process holding the recording database handle; the next start then failed to open it and recording was silently lost. A 10-second watchdog force-exits a supervised process so the lock is always released.
- **Overlays are no longer covered by zero-index UI.** The z-index tokens never produced `z-modal` / `z-tour` classes, so overlays and modals silently fell back to `auto` and the top bar (z-50), the components palette's sticky section headers (z-10) and similar elements drew over them. The tokens are now emitted as plain custom properties plus bridge classes, and the tour layer sits above React Flow's selected-node layers (1000 / 1001).

### Engineering

- Removed the bundled FiraCode Nerd Font Mono and GoMono Nerd Font Mono families (about 6.7 MiB of woff2) and simplified the default font stacks: UI starts at MiSans, mono starts at JetBrains Mono with Maple Mono CN behind it. The About dialog's attribution list and the settings defaults follow the same change.
- New regression tests cover the recording gate (a locked database must not raise a writer fault, a database locked by another process must fail to open in bounded time, a recording writer that never answers must time out instead of blocking acquisition or run control, and reads must go through the writer rather than opening a second instance), raw-data grid alignment and line wrapping, scroll-pause binding, display liveness, the panel liveness badge and outline, the recording indicator, and the back-to-latest button.
- Version numbers advance to v0.7.2 (bundle metadata stays `0.7.2`); the beta channel manifest is published by CI from the build artifacts.

### Distribution

- Desktop: macOS `.dmg` (Apple Silicon / Intel), Linux `.deb` / `.AppImage`, and Windows `.msi` / `.exe` (NSIS).
- Deployment options also include standalone backend and Web archives, plus a container image for the server and Web frontend. Consult the release assets for available builds.

---

# Lissio v0.7.2-beta 发布说明

**暂停也保留数据、全部面板共用一条时效规则、原始数据视图更稳定**

> 本版本为 v0.7.x 线上的 beta 构建，欢迎试用并反馈问题。
> 若从 v0.6.1 或更早版本升级：本版不再支持旧版工作区、配置及持久化数据格式，也不提供自动迁移。升级前请备份现有数据；旧工作区和设置可能需要重新创建。

### 暂停与停止现在是两件事

- **暂停不再丢数据。** 保持连接与采集链路运行：字节继续解析并写入波形 / 原始数据 / CAN / 逻辑缓存与录制数据库，图求值照常进行，只停自动发送与设备写。
  - 暂停期间录制持续落库，会话状态反映实际写入；换 recorder 时持执行边界写锁，批次不会落在 recorder 缺席的窗口。
  - 从暂停恢复保持数据连续：不重建流序列，也不重置协议解析器与瞬时状态。
  - 工作区暂停但仍在落库时，状态栏运行按钮旁显示 **录制中**。
- **停止仍是硬门控。** 在途数据直接丢弃且不进入任何缓存，已有缓存保留；停止态收到 `pause` 为 no-op。

### 一条规则决定面板是否实时

- 及时显示改由单一派生层给出：**及时 = 工作区运行中且该面板跟随最新**。面板不再各写一套冻结判断。
- 非实时面板会得到 **非实时** 角标（warning 语义色 + 警示图标）以及内容区四周的 warning 色边框。边框只描边、不改面板自身的数据配色，也不拦截指针事件。
- 工作区暂停或停止算非实时；用户把该面板拖离最新（波形水平延迟 > 0、列表上滚、关闭自动滚动）同样算非实时。
- 从暂停恢复时统一广播一次「跳最新」：波形复位水平延迟并恢复实时跟随，原始数据 / CAN / 逻辑列表恢复自动滚动并跳到末尾 —— 恢复即落在最新状态，而不是从冻结帧继续。

### 列表上滚即暂停工作区

- 原始数据 / CAN / 逻辑事件列表面板上滚现在真的会暂停工作区，按卡片引用计数。此前这段接线是缺失的：滚动暂停协调器只有纯逻辑、无人挂接，而高速追底会盖过滚轮输入，视口连脱离都做不到。
- 只有用户主动上滚（滚轮上滚、触摸拖动、滚动条上拖）才触发 —— 视口只是暂时不在底部不触发。
- 恢复是显式动作：点 **回到最新数据** 按钮，或重新开启自动滚动（含暂停恢复时的统一跳最新）。恰好滑到底部不会自动恢复，手动 start/stop 过的面板也不会被自动重新启动。

### 原始数据面板

- **刷新不再闪烁。** 跟随过程改为逐帧连续追赶，只在「追赶已无意义」（落后超过 20000px）时才瞬时跳底；网格视图行起点改为按绝对字节流对齐，环形缓冲回绕后行内容不再整体错位一列 —— 同一个绝对字节在相邻两帧落在同一列。
- WebKit 异步派发的 scroll 事件不再被误判成「用户接管」：改为比对最近若干次程序化写入与上报偏移，跟随不再半途停住。
- 上滚脱离最新后，右下角出现 **回到最新数据** 按钮；脱离状态下自动滚动按钮显示非激活态。
- 修复行视图溢出；自动滚动按钮的激活态改为跟随响应式脱离标记，不再依赖可变 ref。
- 长行收敛：单行超过 64 字节自动折行，不再让整段无换行数据挤进一行；折行点回退到 UTF-8 序列起点，多字节字符不会被截成替换符。折行续行有标记，复制时不会插入换行。

### 修复

- **工作区运行时右键恢复正常。** 上下文菜单会在捕获阶段对**任何** `scroll` 事件关闭自己，而运行中的数据面板每帧写 `scrollTop` 追随最新 —— 菜单在同一帧内就被拆掉、还没来得及绘制，而 `preventDefault` 已经挡掉了原生菜单。现在只有**视口自身**滚动才关闭菜单，元素级滚动不再影响；没有定义菜单项的表面也不再吃掉右键（数据卡片标签栏原先什么都不弹）。
- **历史数据库页面不再显示 `[object Object]`。** 出口失败时拒绝的是普通对象 `RpcError { kind, message }` 而不是 `Error`，录制 store 却用 `String(...)` 格式化后直接渲染进面板错误条。新增统一的 `errorText`：`Error` / 字符串 / `{ kind, message }` 一律取 message（无 message 才退化为 JSON），`formatError` 复用同一实现，各 store、连接页与显示面板的同类写法一并收敛。
- **正常背压不再中止采集。** 写线程队列打满曾被判成「录制写入故障」，而这个标记会一直粘到换 recorder 为止 —— 于是一次瞬态突发之后，每次「开始」都在一批数据内被打回停止态（表现就是「只出几个字符、暂停也解不开」）。现在只有**已受理却落不了盘**的批次才算故障，任一次成功写入即清除，队列也大幅加长以吸收 checkpoint / 杀毒扫描造成的停顿。
- **写入线程不应答不再冻结界面。** 控制往返（会话状态、绑定、flush、维护、关停）在**投递**与**应答**两侧都有界：运行控制 5 秒、关停 10 秒、flush / 删除会话 120 秒。不应答的 writer 会被摘除并报「不可用」，而不是堵住采集热路径或运行控制；换 recorder 时独占的执行边界写锁最迟 30 秒释放。
- **录制现在可以运行期关闭。** 设置 → 数据新增「录制数据库」开关（默认开）：任意运行态下关闭即释放 recorder 与 DuckDB 文件句柄，重新打开即原库续录。已有数据库文件与历史一律保留。这是 Windows 上「数据库本身卡住」时的逃生舱；录制面板与视图会灰化并说明原因，而不是显示成故障。
- **并发实例不再损坏录制历史，打开数据库也不再卡住。** 查询、导出、会话检查、历史分页与只读 SQL 现在全部走写线程的**同一个** DuckDB 连接，不再各自打开一个实例 —— 多个实例会各自 checkpoint 并互相覆盖，静默抹掉已提交的写入。
  - 打开前先做强制锁探测，打开本身有 30 秒上限：被别的进程占住的库会快速失败并报「录制不可用」，而不是把界面挂在那里。
  - 打开时还会校验：catalog 损坏时经既有修复路径自动重建并继续录制，面板会给出提示；它走的是**提示**通道而不是失败通道（失败会停掉采集）。
- **录制数据库被占用不再中止采集。** 数据库打不开时（例如 Windows 上另一个实例持有该文件的强制锁），现在报「录制不可用」而不是「录制写入故障」，采集照常运行、只是没有录制，不再被永久挡住。
  - 数据库旁的进程级锁文件让第二个实例快速失败，而不是两个 DuckDB 写入方互相 checkpoint、静默抹掉已提交数据。
- **受监督后端现在能在有界时间内退出。** 收尾若卡住，残留进程会一直持有录制数据库句柄，下一次启动打不开数据库、录制静默丢失。新增 10 秒看门狗，超时强制退出，确保锁一定释放。
- **遮罩不再被零层级的界面元素盖住。** 层级令牌此前不会生成 `z-modal` / `z-tour` 类名，遮罩与弹窗的 z-index 静默退化成 `auto`，于是顶栏（z-50）、控件分类的 sticky 标题（z-10）等元素会盖在其上。现在令牌同时输出为普通自定义属性与桥接类，引导层也高于 React Flow 的选中节点层级（1000 / 1001）。

### 工程改进

- 移除随包分发的 FiraCode Nerd Font Mono 与 GoMono Nerd Font Mono 两族字体（约 6.7 MiB woff2），并简化默认字体栈：UI 首选 MiSans，等宽首选 JetBrains Mono、次选 Maple Mono CN。关于弹窗的字体署名清单与设置默认值同步更新。
- 新增回归测试覆盖：录制门控（数据库被占用不得报写入故障；被别的进程锁住的库必须能在有界时间内打开失败；永不应答的写入线程必须超时返回，而不是堵住采集与运行控制；读必须经写线程而不是另开实例）、原始数据网格对齐与折行、滚动暂停接线、显示时效派生、面板角标与描边、录制中指示、回到最新按钮。
- 版本号推进到 v0.7.2（打包元数据仍为 `0.7.2`）；beta 通道清单由 CI 从构建产物发布。

### 分发形式

- 桌面安装包：macOS `.dmg`（Apple Silicon / Intel）、Linux `.deb` / `.AppImage`、Windows `.msi` / `.exe`（NSIS）。
- 同时提供独立后端与 Web 构建归档，以及服务端与 Web 前端容器镜像的部署方式。可用构建以发布附件为准。

[Full Changelog / 完整变更](https://github.com/Horldsence/Lissio/compare/v0.6.1...v0.7.2)
