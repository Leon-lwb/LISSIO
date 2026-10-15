//! `local_server` 端口决策的单元测试。

use super::wants_rebind;

#[test]
fn vague_requests_reuse_the_running_listener() {
    assert!(!wants_rebind(None, 8765));
    assert!(!wants_rebind(Some(0), 8765));
}

#[test]
fn the_same_port_reuses_the_running_listener() {
    assert!(!wants_rebind(Some(8765), 8765));
}

#[test]
fn a_different_explicit_port_rebinds() {
    assert!(wants_rebind(Some(8766), 8765));
    assert!(wants_rebind(Some(8765), 9000));
}
