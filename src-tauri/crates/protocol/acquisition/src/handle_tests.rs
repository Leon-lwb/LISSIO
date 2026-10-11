use super::*;
use std::sync::atomic::AtomicBool;

#[tokio::test]
async fn close_drops_write_sender_and_rejects_further_writes() {
    let (write_tx, mut write_rx) = mpsc::channel(1);
    let (data_tx, _data_rx) = broadcast::channel(1);
    let cancel = Arc::new(AtomicBool::new(false));
    let handle = TransportHandle::new(
        TransportConnection::from_cancel_flag(write_tx, data_tx, cancel),
        TransportConfig::TestData(TestDataConfig::default()),
        1,
    );

    handle.close();

    assert!(write_rx.recv().await.is_none());
    assert!(handle.send(b"after-close").is_err());
}
