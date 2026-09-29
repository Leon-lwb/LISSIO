# 设备调试实战手册

## 任务一: 连接设备并显示波形

1. 先询问或确认目标设备、协议和期望信号；list_serial_ports / list_driver_manifests
   查询可用端口和驱动能力。
2. get_workspace → 了解当前 tab、节点、连线与 derived_ports。
3. 若无现成节点:用能力目录中的 adapter id 调用 add_node(type=device, kind=...)
   → add_node(type=protocol, kind=JustFloat) → add_node(type=widget, kind=Waveform)。
4. connect_edge: device.rx → protocol.in;protocol 通道口 → waveform.data。
5. connect_device(node_id=...);run_workspace(action=start) 启动处理。
6. 如需指令且内容已知,用 send_string / send_bytes 发送。
7. get_recent_waveform(source=protocol 节点 id, count=100) 验证有数据;
   或 get_graph_outputs 看各端口实时值。

设备协议不是 JustFloat/FireWater 时,用 add_node(type=widget, kind=FrameDecoder)
建自定义帧解析,field 块命名 portName 输出。

## 任务二: 周期控制/采集

- 输入控制: add_node(type=widget, kind=Knob/Slider) → connect 到下游;或直接
  set_input_value(widget_id, value) 立即改值触发求值。
- Button 按下发值: set_input_value 同样适用 (pressValue)。
- TextInput + TextOut 可把字符串写回设备的 tx。

## 任务三: 无硬件调试协议

1. 在同一页签搭好 设备 → Protocol → 显示 链路。
2. 可给设备附加“测试数据”属性后重连，也可用
   inject_bytes(source_node_id=device id, data=[...]) 单次注入帧。
3. run_workspace(action=start),再用 get_graph_outputs / get_recent_waveform 验证解析结果。

## 任务四: 排查"没有数据"

1. 确认工作区已启动；list_endpoints / list_devices → 设备会话是否已连接。
2. 字节设备用 get_raw_data(source=device id) 查 TX/RX；点位设备用 read_points 查值与质量。
3. 来源正常但无波形 → 检查连线 (get_workspace) 与协议类型/channels。
4. get_buffer_info(source=协议 id) → 缓冲是否有累积点数。

## 任务五: CAN 总线调试

1. 用 list_driver_manifests 确认 CAN adapter id,再 add_node(type=device,
   kind=对应 adapter id) → connect_device → run_workspace(action=start)。
2. get_can_frames(count=100) 查看最近帧 + 负载。
3. send_can_frame(node_id=..., frame={id: 0x123, data: [1,2,3], direction: "tx"})。

## 任务六: 快速搭建演示工作区

apply_template(template_id=...) 一键应用内置模板 (先 list_templates 查可用模板),
适合给用户演示标准链路。

## 任务七:点位读取与写入

1. list_device_tree_nodes / list_endpoints 确认采集节点和连接状态；必要时
   open_endpoint(node_id=...)。
2. 用设备树与能力结果确认 point_ids,再 read_points(node_id, point_ids) 读取原值与质量。
3. 若用户明确要写入,先确认目标点位、值和设备,按 write_points 的 request schema
   提交；再 read_points 验证结果。不要把坏质量或过期值当作成功。

## 任务八:录制与历史分析

1. list_recording_sessions → 找会话；list_recording_bindings(session_id) → 找通道绑定。
2. 新建或切换写入目标前 run_workspace(action=pause),再调用
   create_recording_session / switch_recording_session。
3. 读取前 flush_recording；用 query_recording_history 分页查看,或用
   query_recording_sql 做只读聚合。需要文件时调用 export_recording_data。

## 通用工作约定

- 先说明执行目标；关键设备、协议、点位或命令内容不明确时主动询问,同时做安全读取。
- 内置 AI 编辑前先 get_workspace 读现状;小步修改,每步用对应读取工具验证。
- 节点 id 是一切工具的主键，必须从 get_workspace 或工具结果读取。
- 编译失败 (环/端口不匹配) 会返回错误且保留旧图 — 修正后重试即可。
