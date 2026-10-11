use super::*;

/// 节点声明 8 个波形工具。
#[test]
fn node_declares_tools() {
    let n = node();
    let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
    assert_eq!(
        names,
        vec![
            "get_recent_waveform",
            "get_waveform_window",
            "get_buffer_info",
            "list_data_sources",
            "create_waveform_snapshot",
            "query_waveform_snapshot",
            "release_waveform_snapshot",
            "export_waveform_csv",
        ]
    );
    assert!(n.skills.is_empty());
}
