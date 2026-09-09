# Lissio 软件与核心概念总览

Lissio 是一款数据采集与调试上位机 (VOFA+ 的下一代),面向嵌入式开发中的
串口 / TCP / UDP / CAN / 逻辑分析仪调试场景。核心能力:设备连接、协议解析、
波形显示、控件交互面板、CAN 总线分析、逻辑解码。

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

- 节点图读写:get_workspace 读画布全量状态;add_node / remove_node /
  update_node_config / connect_nodes / disconnect_edge / move_node 增量编辑
  (与手工编辑等效:画布实时刷新,进撤销历史)。
- 设备:list_devices / list_serial_ports 查询;connect_device / disconnect_device 连接;
  send_bytes / send_string / send_can_frame 发送。
- 数据读取:get_graph_outputs (全部输出端口最新值)、get_recent_waveform /
  get_waveform_window (波形)、get_can_frames (CAN)、get_logic_data (逻辑解码)、
  get_raw_data (原始字节 TX/RX)、get_buffer_info、list_data_sources。
- 其他:set_input_value 控制输入控件、apply_template 一键搭建模板工作区。

## 数据流示例

带“测试数据”属性的串口设备 → Protocol(JustFloat) → Waveform:
连接 `device.rx → protocol.in`,再把协议数值通道连到显示控件，调用
`connect_device` 后启动模拟会话，真实串口不会被打开。
