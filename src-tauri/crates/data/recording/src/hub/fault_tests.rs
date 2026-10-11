use super::{FailureClass, classify};
use crate::RecordingError;
use std::time::Duration;

#[test]
fn transient_conditions_never_break_the_acquisition_contract() {
    // 回归: 这两种曾经被当成写入故障, 于是运行控制每批数据后都把工作区
    // 停回 Stopped —— Windows 上表现为「点开始只出几个字符, 暂停也解不开」。
    assert_eq!(
        classify(&RecordingError::Backpressure),
        FailureClass::Dropped,
        "队列打满是正常背压, 不是故障"
    );
    assert_eq!(
        classify(&RecordingError::Invalid("binding moved".into())),
        FailureClass::Dropped,
        "图编辑与在途批次的竞态不是故障"
    );
}

#[test]
fn a_wedged_writer_only_makes_recording_unavailable() {
    // writer 卡住不得停止采集: 采集连续性与录制完整性是两件事。
    assert_eq!(
        classify(&RecordingError::Timeout(Duration::from_secs(1))),
        FailureClass::Unavailable
    );
}

#[test]
fn accepted_batches_that_cannot_be_persisted_are_a_fault() {
    for error in [
        RecordingError::Failed("disk gone".into()),
        RecordingError::Corrupt("bad catalog".into()),
        RecordingError::Closed,
        RecordingError::Io(std::io::Error::other("io")),
    ] {
        assert_eq!(
            classify(&error),
            FailureClass::Contract,
            "{error} 意味着已受理批次落不了盘"
        );
    }
}
