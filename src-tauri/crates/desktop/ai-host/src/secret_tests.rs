#[cfg(debug_assertions)]
use super::{DevEnvSecretStore, SecretStore, parse_dev_env};
use super::{SecretSource, choose_secret, choose_status, environment_name, map_keyring_error};
#[cfg(target_os = "macos")]
use error::AiError;
use error::Error as _;

#[test]
fn ordinary_keyring_failure_stays_generic() {
    let error = keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("locked")));
    assert_eq!(map_keyring_error(error).kind(), "AiKeyring");
}

#[test]
fn adapter_names_map_to_provider_specific_environment_variables() {
    assert_eq!(
        environment_name("openai-compatible").unwrap(),
        "LISSIO_AI_API_KEY_OPENAI_COMPATIBLE"
    );
    assert!(environment_name("").is_err());
}

#[test]
fn keyring_wins_and_environment_is_a_read_only_fallback() {
    assert_eq!(
        choose_secret::<()>(Ok(Some("keyring".into())), Some("environment".into())).unwrap(),
        Some("keyring".into())
    );
    let status = choose_status::<()>(Err(()), Some("environment".into())).unwrap();
    assert!(status.configured);
    assert_eq!(status.source, Some(SecretSource::Environment));
    assert!(!status.writable);
    assert!(choose_status::<()>(Err(()), None).is_err());
}

#[cfg(debug_assertions)]
#[test]
fn debug_env_reads_provider_key_without_keyring_and_is_read_only() {
    let path = crate::test_support::unique_temp_path("lissio-dev-secret");
    std::fs::write(
            &path,
            "# local keys\nexport LISSIO_AI_API_KEY_OPENAI='test-key'\nLISSIO_AI_API_KEY_ANTHROPIC=other\n",
        )
        .unwrap();
    let store = DevEnvSecretStore { path: path.clone() };
    assert_eq!(store.resolve("openai").unwrap(), Some("test-key".into()));
    assert_eq!(store.resolve("gemini").unwrap(), None);
    assert_eq!(
        store.status("openai").unwrap(),
        super::SecretStatus {
            configured: true,
            source: Some(SecretSource::Environment),
            writable: false,
        }
    );
    assert_eq!(
        store.set("openai", "replacement").unwrap_err().kind(),
        "AiDevEnvReadOnly"
    );
    assert_eq!(
        store.delete("openai").unwrap_err().kind(),
        "AiDevEnvReadOnly"
    );
    assert_eq!(store.resolve("openai").unwrap(), Some("test-key".into()));
    std::fs::remove_file(path).unwrap();
}

#[cfg(debug_assertions)]
#[test]
fn debug_env_last_assignment_can_clear_a_secret() {
    assert_eq!(
        parse_dev_env(
            "LISSIO_AI_API_KEY_OPENAI=first\nLISSIO_AI_API_KEY_OPENAI=\n",
            "LISSIO_AI_API_KEY_OPENAI"
        ),
        None
    );
}

#[cfg(target_os = "macos")]
#[test]
fn macos_auth_failure_and_cancel_are_access_denied() {
    for code in [-25_293, -128] {
        let source = security_framework::base::Error::from_code(code);
        let error = keyring::Error::PlatformFailure(Box::new(source));
        assert!(matches!(
            map_keyring_error(error),
            AiError::KeyringAccessDenied { .. }
        ));
    }
}
