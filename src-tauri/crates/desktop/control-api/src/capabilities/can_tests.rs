use super::*;

/// 帧 DTO 转换: 方向/远程帧/缺省按 id 推断扩展帧/8 字节截断。
#[test]
fn frame_dto_conversion() {
    let frame = CanFrame::from(CanFrameDto {
        id: 0x123,
        extended: Some(false),
        rtr: true,
        data: vec![1, 2],
        direction: Some("tx".into()),
    });
    assert_eq!(frame.id, 0x123);
    assert!(!frame.extended);
    assert!(frame.rtr);
    assert_eq!(frame.dlc, 2);
    assert_eq!(frame.direction, can::CanDirection::Tx);

    // 29 位 id 缺省推断为扩展帧; 超长数据截断到 8 字节
    let ext = CanFrame::from(CanFrameDto {
        id: 0x1ABCDEF0,
        extended: None,
        rtr: false,
        data: vec![9; 9],
        direction: None,
    });
    assert!(ext.extended, "29 位 id 应推断为扩展帧");
    assert_eq!(ext.data.len(), 8);
    assert_eq!(ext.dlc, 8);
    assert_eq!(ext.direction, can::CanDirection::Rx);
}

/// 节点声明 2 个工具。
#[test]
fn node_declares_tools() {
    let n = node();
    let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
    assert_eq!(names, vec!["get_can_frames", "send_can_frame"]);
}
