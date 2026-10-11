use super::*;
use bus::{Sample, TopicKey};
use std::sync::Arc;

#[test]
fn binary_sample_contract_has_stable_header_and_zero_value() {
    let batch = SampleBatch {
        topic: TopicKey::new("FireWater", "ch3"),
        sequence: 7,
        samples: Arc::from([Sample {
            sequence: 9,
            timestamp_us: 11,
            value: 0.0,
        }]),
        status: SampleStatus::Live,
        preview_skipped: 1,
        retention_evicted: 2,
        ingress_dropped: 3,
    };
    let bytes = encode_samples(&batch);
    assert_eq!(&bytes[..4], b"VNDP");
    assert_eq!(bytes.len(), SAMPLE_HEADER_LEN + 17);
    assert!(f64::from_le_bytes(bytes[76..84].try_into().unwrap()).abs() < f64::EPSILON);
    assert_eq!(bytes[84], 1);
}
