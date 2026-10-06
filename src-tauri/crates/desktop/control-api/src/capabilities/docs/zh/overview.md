# Lissio 软件与核心概念总览

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: src-tauri/crates/desktop/control-api/src/capabilities/docs/en/overview.md
applies-to: Runtime Chinese capability help translation
-->

> 中文产品翻译；英文运行时文档为权威版本。若中英文不一致，以英文为准。
> Chinese product translation. The English runtime document is authoritative; English controls in case of conflict.

Lissio 是一款面向嵌入式开发的数据采集与调试上位机，支持 VOFA+ 兼容协议，覆盖
串口 / TCP / UDP / CAN / 逻辑分析仪及工业点位调试场景。核心能力:设备树与
采集端点、协议解析、波形与控件、CAN/逻辑分析、命令帧、数据录制与历史查询。

## 类型化数据架构

- **字节设备**暴露类型化 `rx/tx` 端口,连接解析与编码节点。
- **点位设备**暴露 `points` 端口；点位选择节点按稳定点位 ID 生成具名数值输出，
  原始值与质量一直保留到显式投影边界。
- 每个控件页独立编译，设备、解析器和控件都归属该页；跨页签连线直接拒绝。

## 画布与节点

- **控制页 (tab)**:用户可建多个页签,每页是一张完整画布,拥有其全部节点。
- **设备节点**:串口、TCP、UDP、Slcan、CandleLight 与 Modbus 都来自统一能力目录，
  使用同一会话生命周期。
- **widget 节点**:输入控件 (Knob/Slider/Button/...)、显示控件 (Waveform/Gauge/...)、
  计算节点 (Math/Filter/FFT/FrameDecoder/Trigger/...) 都以 widget 形式放在某 tab 内。
- **边**:字节边 (Vec<u8>,Transport→Protocol 等) 与数值边 (f32,控件间)。
  连线时后端自动编译、派生端口表;编译失败保留旧图并报错。

## 软件操作入口 (内置 AI 工具)

- 节点图读写:内置 AI 用 get_workspace 读画布全量状态,用 add_node / remove_node /
  update_node_config / move_node 编辑节点；connect_edge / disconnect_edge 增量连线,
  update_graph 原子替换整页图。连线由后端编译校验。
- 设备与运行:list_driver_manifests / list_device_tree_nodes / list_endpoints 查询
  能力和状态；内置 AI 可用 connect_device / disconnect_device,后端能力工具提供
  open_endpoint / close_endpoint、read_points / write_points、run_workspace。
- 传输与命令:list_devices / list_serial_ports 查询;send_bytes / send_string /
  send_can_frame / send_command_frame 发送,compute_command_frame_bytes 预览组帧。
- 数据读取:get_graph_outputs (全部输出端口最新值)、get_recent_waveform /
  get_waveform_window (波形)、get_can_frames (CAN)、get_logic_data (逻辑解码)、
  get_raw_data (原始字节 TX/RX)、get_buffer_info、list_data_sources。
- 波形与历史:create_waveform_snapshot / query_waveform_snapshot 冻结并查询波形,
  export_waveform_csv 导出；录制工具管理会话、查询历史或只读 SQL、导出数据。
- 其他:set_input_value 控制输入控件；内置 AI 可用 apply_template 搭建模板工作区。

## 数据流示例

带“测试数据”属性的串口设备 → Protocol(JustFloat) → Waveform:
连接 `device.rx → protocol.in`,再把协议数值通道连到显示控件，调用
`connect_device` 后启动模拟会话，真实串口不会被打开。