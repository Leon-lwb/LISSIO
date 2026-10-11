use super::*;
use crate::S7Area;
use crate::client::is_disconnect;

#[test]
fn byte_read_items_use_the_byte_transport() {
    let plan = ReadPlan {
        area: S7Area::Db,
        db_number: 10,
        period_ms: 100,
        start: 4,
        byte_count: 6,
        points: Vec::new(),
    };
    let item = byte_read_item(&plan);
    assert_eq!(item.variable_type, S7ParamVariableType::Byte);
    assert_eq!(item.count, 6);
    assert_eq!(item.db_number, 10);
    assert_eq!(item.area, tokio_s7::types::S7Area::DataBlocks);
    assert_eq!(item.byte_address, 4);
    assert_eq!(item.bit_address, 0);
}

#[test]
fn per_item_return_codes_map_to_quality_without_disconnect() {
    let error = S7ReturnCode::InvalidAddress;
    let operation = OperationError::new(
        &format!("returnCode:0x{:02X}", error.code()),
        error.description(),
        false,
    );
    assert!(!operation.disconnect);
    assert_eq!(
        operation.code,
        format!("returnCode:0x{:02X}", S7ReturnCode::InvalidAddress.code())
    );
}

#[test]
fn sdk_disconnect_classification_covers_actor_death() {
    use tokio_s7::error::S7Error;
    assert!(is_disconnect(&S7Error::Error("Actor disconnected".into())));
    assert!(is_disconnect(&S7Error::Error("Not connected".into())));
    assert!(!is_disconnect(&S7Error::Error(
        "Response error: class=AccessError, code=135".into()
    )));
    assert!(is_disconnect(&S7Error::ConnectionClosed));
}
