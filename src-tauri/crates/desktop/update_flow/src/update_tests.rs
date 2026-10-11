use super::*;

#[test]
fn stable_channel_uses_latest_release_manifest() {
    assert_eq!(
        manifest_url(Channel::Stable),
        "https://codeberg.org/Horldsence/Lissio/releases/download/stable/latest.json"
    );
}

#[test]
fn beta_channel_uses_rolling_beta_tag_manifest() {
    assert_eq!(
        manifest_url(Channel::Beta),
        "https://codeberg.org/Horldsence/Lissio/releases/download/beta/beta-latest.json"
    );
}

#[test]
fn manifests_are_valid_urls_and_never_hit_github_api() {
    // 回归保护: manifest 必须走 release 资产服务, 不得回到 GitHub API
    // (未认证限额 60 次/小时/IP, 超额 403), 也不得使用 Codeberg 不支持、
    // 实测 404 的 `releases/latest/download/...` 伪路径
    assert_ne!(STABLE_MANIFEST, BETA_MANIFEST);
    for url in [STABLE_MANIFEST, BETA_MANIFEST] {
        let parsed = reqwest::Url::parse(url).expect("manifest 必须是合法 URL");
        assert_eq!(parsed.host_str(), Some("codeberg.org"));
        assert_ne!(parsed.host_str(), Some("api.github.com"));
        assert!(
            !parsed.path().contains("/releases/latest/"),
            "Codeberg 不支持 releases/latest 伪路径: {url}"
        );
    }
}
