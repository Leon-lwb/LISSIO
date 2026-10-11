use super::{
    BINARY_FRAME_HEADER, BINARY_FRAME_VERSION, ClientMessage, RpcResponse, ServerMessage,
    encode_binary_frame,
};
use serde_json::json;

#[test]
fn binary_frame_header_layout_is_stable() {
    let frame = encode_binary_frame(7, &[0xAA, 0xBB, 0xCC]);
    assert_eq!(frame.len(), BINARY_FRAME_HEADER + 3);
    assert_eq!(frame[0], BINARY_FRAME_VERSION);
    assert_eq!(frame[1], 1, "json/binary format tag");
    assert_eq!(&frame[2..6], &7_u32.to_be_bytes());
    assert_eq!(&frame[6..10], &3_u32.to_be_bytes());
    assert_eq!(&frame[10..], &[0xAA, 0xBB, 0xCC]);
}

#[test]
fn client_message_uses_lowercase_type_tag() {
    let parsed: ClientMessage =
        serde_json::from_value(json!({ "type": "unsubscribe", "id": 3 })).expect("解析应成功");
    assert!(matches!(parsed, ClientMessage::Unsubscribe { id: 3 }));
}

#[test]
fn subscribe_frame_does_not_accept_client_chosen_id() {
    let parsed: ClientMessage = serde_json::from_value(json!({
        "type": "subscribe",
        "args": { "request": { "kind": "waveform" } }
    }))
    .expect("解析应成功");
    assert!(matches!(parsed, ClientMessage::Subscribe { .. }));
}

#[test]
fn rpc_response_omits_empty_fields() {
    let ok = serde_json::to_value(RpcResponse::success(json!(1), json!({"a": 1})))
        .expect("序列化应成功");
    assert!(ok.get("error").is_none());
    let err = serde_json::to_value(RpcResponse::failure(json!(1), json!({"kind": "X"})))
        .expect("序列化应成功");
    assert!(err.get("result").is_none());
    assert_eq!(err["ok"], json!(false));
}

#[test]
fn fault_is_attributable_only_when_it_concerns_a_subscription() {
    // 订阅建立失败: 客户端已先收到回执, 必须靠 id 把失败归到该订阅
    let subscription =
        serde_json::to_value(ServerMessage::subscription_fault(9, "boom")).expect("序列化应成功");
    assert_eq!(subscription["type"], json!("fault"));
    assert_eq!(subscription["id"], json!(9));
    assert_eq!(subscription["message"], json!("boom"));

    // 帧级错误没有归属: 省略 id, 客户端只作日志
    let plain = serde_json::to_value(ServerMessage::fault("bad frame")).expect("序列化应成功");
    assert!(plain.get("id").is_none());
}
