use super::*;

/// 布局命令载荷可同时表达自适应与显式尺寸。
#[test]
fn position_size_roundtrip() {
    let auto = serde_json::to_value(Position::new(1.0, 2.0)).expect("序列化应成功");
    assert_eq!(auto, serde_json::json!({"x": 1.0, "y": 2.0}));

    let sized: Position =
        serde_json::from_str(r#"{"x": 1.0, "y": 2.0, "width": 320, "height": 240}"#)
            .expect("带尺寸格式应可解析");
    assert_eq!(sized.width, Some(320.0));
    assert_eq!(sized.height, Some(240.0));
    let back = serde_json::to_value(sized).expect("序列化应成功");
    assert_eq!(
        back,
        serde_json::json!({"x": 1.0, "y": 2.0, "width": 320.0, "height": 240.0})
    );
}
