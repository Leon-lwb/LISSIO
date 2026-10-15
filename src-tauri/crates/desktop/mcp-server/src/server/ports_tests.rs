//! `ports` 的单元测试 — 解析器用固定文本夹具, 探测用真实 loopback 套接字。

use std::net::TcpListener;

use super::{
    check_port, local_port, parse_lsof_listener, parse_netstat_pid, parse_tasklist_name, probe,
    suggest_port,
};

/// 找一个当前空闲的 loopback 端口 (绑上后立即释放)。
fn free_port() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral");
    listener.local_addr().expect("local addr").port()
}

#[test]
fn netstat_pid_prefers_the_listening_row() {
    let table = "\
活动连接

  协议  本地地址          外部地址        状态           PID
  TCP    127.0.0.1:8765         0.0.0.0:0              TIME_WAIT       4242
  TCP    127.0.0.1:8765         0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:8790         0.0.0.0:0              LISTENING       908
";
    assert_eq!(parse_netstat_pid(table, 8765), Some(1234));
    assert_eq!(parse_netstat_pid(table, 8790), Some(908));
    assert_eq!(parse_netstat_pid(table, 8766), None);
}

#[test]
fn netstat_pid_falls_back_when_the_state_column_is_localized() {
    let table = "  TCP    127.0.0.1:8765         0.0.0.0:0              侦听             77\n";
    assert_eq!(parse_netstat_pid(table, 8765), Some(77));
}

#[test]
fn netstat_pid_ignores_non_tcp_and_short_lines() {
    let table = "\
  UDP    127.0.0.1:8765         *:*                                    55
  TCP    127.0.0.1:8765
";
    assert_eq!(parse_netstat_pid(table, 8765), None);
}

#[test]
fn local_port_reads_ipv4_and_ipv6_forms() {
    assert_eq!(local_port("127.0.0.1:8765"), Some(8765));
    assert_eq!(local_port("[::]:8765"), Some(8765));
    assert_eq!(local_port("0.0.0.0:0"), Some(0));
    assert_eq!(local_port("*:*"), None);
}

#[test]
fn tasklist_name_strips_quotes_and_keeps_spaces() {
    assert_eq!(
        parse_tasklist_name("\"chrome.exe\",\"1234\",\"Console\",\"1\",\"123,456 K\"\r\n"),
        Some("chrome.exe".to_string())
    );
    assert_eq!(
        parse_tasklist_name("\"My App.exe\",\"9\",\"Console\",\"1\",\"1 K\"\n"),
        Some("My App.exe".to_string())
    );
    assert_eq!(parse_tasklist_name("\n  \n"), None);
}

#[test]
fn lsof_listener_skips_the_header_row() {
    let listing = "\
COMMAND   PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    12345 peng   23u  IPv4 0x1234567890abcdef      0t0  TCP 127.0.0.1:8765 (LISTEN)
";
    assert_eq!(
        parse_lsof_listener(listing),
        Some("node (PID 12345)".to_string())
    );
    assert_eq!(parse_lsof_listener("COMMAND   PID   USER\n"), None);
}

#[test]
fn a_bound_port_is_reported_unavailable_with_a_suggestion() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral");
    let port = listener.local_addr().expect("local addr").port();

    let check = check_port(port);
    assert!(!check.available, "port {port} is bound by this test");
    assert_eq!(check.port, port);
    let suggested = check.suggested_port.expect("an alternative must exist");
    assert_ne!(suggested, port);
    assert!(probe(suggested), "suggestion {suggested} must be bindable");
}

#[test]
fn a_free_port_is_reported_available_without_a_suggestion() {
    let port = free_port();
    let check = check_port(port);
    assert!(check.available, "port {port} was just released");
    assert_eq!(check.occupant, None);
    assert!(!check.reserved_hint);
    assert_eq!(check.suggested_port, None);
}

#[test]
fn suggest_port_skips_the_occupied_candidate() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral");
    let port = listener.local_addr().expect("local addr").port();
    let suggested = suggest_port(port).expect("a free neighbour must exist");
    assert!(suggested > port);
}
