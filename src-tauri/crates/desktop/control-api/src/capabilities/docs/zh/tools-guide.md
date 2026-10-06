# 内置工具使用指南

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: src-tauri/crates/desktop/control-api/src/capabilities/docs/en/tools-guide.md
applies-to: Runtime Chinese capability help translation
-->

> 中文产品翻译；英文运行时文档为权威版本。若中英文不一致，以英文为准。
> Chinese product translation. The English runtime document is authoritative; English controls in case of conflict.

Lissio 内置 AI 可用两组工具：能力注册表工具由后端直接执行，前端托管工具通过
界面执行。外部 MCP 客户端只提供能力注册表工具；`get_workspace`、`add_node`、
`connect_device` 等前端托管工具仅供内置 AI 使用。实际可调用工具以本轮模型收到的
工具清单为准。

## 行动范式

1. 先用一句话说明要达成的结果。若目标设备、协议参数、点位、发送内容、时间范围
   或输出路径等关键条件不明确，主动提出少量具体问题；同时可以先做无副作用的发现和读取。
2. 读现状并制定短计划：内置 AI 用 `get_workspace` 查看活跃页、节点文档、连线和
   `derived_ports`；按任务读取设备/端点、驱动、数据源或录制会话。需要格式细节时
   调用 `read_skill`。节点、端点、点位、页签和快照 id 均取自读取或创建结果。
3. 按计划小步执行。使用工具的真实参数 schema；连线或整图提交失败后先读错误，
   修正端口、域或配置再重试。不要捏造标识符、协议字节和硬件状态。
4. 每个有意义的动作后用对应读取工具验证实际结果，最后向用户报告完成的操作、
   观察到的数据和仍需确认的条件。涉及真实设备写入或删除录制数据时，若用户意图
   或目标仍不明确，先问清楚。

## 工作区和图

**前端托管，仅内置 AI：**

- `get_workspace`：返回活跃页、每页 `documents + edges`，以及独立的
  `derived_ports`。编辑现有画布前先读它。
- `add_node`、`update_node_config`、`remove_node`、`move_node`：创建、配置、删除或
  移动设备、协议、点位选择器和控件节点。`add_node` 返回 `node_id`。
- `create_tab`、`set_active_tab`：创建或切换控制页。
- `connect_device`、`disconnect_device`：打开或关闭画布设备节点会话。
- `list_templates`、`apply_template`：先查模板 id，再应用模板；内置 AI 默认新增页签。

**能力注册表，内置 AI 与外部 MCP 共用：**

- `list_tabs`：列出后端已提交的页签 id；它不返回完整画布文档。
- `update_graph {tab_id, documents, edges}`：原子替换指定页的**完整**图文档。
  仅在掌握整页文档和连线时使用，不能用不完整列表做局部更新。
- `connect_edge {source, target, source_handle?, target_handle?, tab_id?}`：增量连线。
  端口可缺省；端口域不匹配、跨页签、成环或端口不存在时，编译失败且不建边。
- `disconnect_edge {edge_id?, source?, target?}`：按边 id 或端点删线。
- `set_input_value {widget_id, value}`：设置数值输入控件并触发求值。
- `get_graph_outputs`：读取输出端口的最新值。

连线前对照 `get_workspace.derived_ports` 中的实际**输出**端口和域,输入端口参考节点
类型文档与当前配置；后端返回的编译错误可用于修正。节点图写入会同步画布；
前端托管的编辑进入撤销历史。

## 设备发现、运行与收发

- `list_driver_manifests`、`list_device_tree_nodes`、`list_endpoints`：分别读取驱动
  ID 与能力、设备树状态、已打开端点。对采集节点使用 `open_endpoint {node_id}` /
  `close_endpoint {node_id}` 开闭子树。
- `run_workspace {action: start|pause|stop}`：控制采集与图求值。运行与暂停都采集、
  写缓存与录制，暂停只停自动发送与设备写；停止丢弃在途数据、清空待发送任务。
  新建或切换录制会话前须暂停。
- `read_points {node_id, point_ids}`、`write_points {node_id, request}`：读写稳定点位 id。
  写入请求包含 `correlationId`、`deadlineUnixNs` 和 `items`，按工具 schema 构造。
- `list_devices`、`list_serial_ports`：查询已打开设备会话和可用串口。
- `send_bytes {node_id, data}`、`send_string {node_id, text}`：向传输设备发送字节或
  UTF-8 文本；`send_string` 不自动加换行。
- `inject_bytes {source_node_id, data}`：把测试字节注入现有字节链路，可用于无硬件解析调试。
- `get_raw_data {source, max_bytes?}`：查看指定源最近的收发字节与方向，最多 64 KiB。
- `compute_command_frame_bytes {frame, inputs?}`：先用同一编码内核预览组帧结果；
  `send_command_frame {widget_id, frame, inputs?}` 沿命令节点下游发送，要求工作区已运行。
- `get_can_frames {count?, bitrate?}`、`send_can_frame {node_id, protocol_node?, frame}`：
  查看或发送 CAN 帧。`get_logic_data {count?}` 读取逻辑采样与解码事件。

## 波形与录制

- `list_data_sources`、`get_buffer_info {source}`：找波形源和缓冲规模。
- `get_recent_waveform {source, count?}`、`get_waveform_window {source, start_ms, end_ms}`：
  查看最新采样或相对最新时间戳的毫秒窗口。`count` 最多 10000。
- `create_waveform_snapshot {source}` → `query_waveform_snapshot {snapshot_id, start_ms,
  end_ms, max_points, selection?}` → `release_waveform_snapshot {snapshot_id}`：冻结、查询并
  释放波形快照。`export_waveform_csv` 按绝对微秒时间戳范围写 CSV，范围必须完整在缓存内。
- `list_recording_sessions`、`list_recording_bindings {session_id}`：先定位会话与绑定。
  `get_recording_health` 查询健康状态，`flush_recording` 确保待写批次落盘。
- `create_recording_session`、`switch_recording_session {session_id}`：控制当前写入目标，
  需先 `run_workspace pause`。`delete_recording_session {session_id}` 删除会话及其数据。
- `query_recording_history {session_id, binding_id?, after_row_id?, from_us?, to_us?, limit?}`：
  分页读取历史；`query_recording_sql {sql, max_rows?}` 执行只读 DuckDB 查询；
  `export_recording_data {request}` 导出记录。

## 知识库和排查

- `list_skills`、`read_skill {skill_id, lang?}`：枚举并按需读取软件知识库全文。
- 没有数据时先确认工作区已运行，再看 `list_endpoints` / `list_devices` 连接状态。
  字节设备用 `get_raw_data` 查原始字节；点位设备用 `read_points` 查值与质量。
  然后检查 `get_workspace` 连线与协议、`get_buffer_info` 缓冲；录制问题再查
  `get_recording_health`。若无法定位来源，先询问用户具体设备或期望信号。
- 数据读取有数量上限；先用小窗口探查，再扩大范围。工具失败信息包含参数或执行原因，
  不应把失败当作成功报告。