//! AI 密钥存储 — debug 构建读取仓库 `.env`，release 构建使用系统钥匙串及环境变量回退。
//!
//! 每个适配器一个条目 (`service = "lissio"`, `user = "ai-api-key-{adapter}"`),
//! 切换服务商互不影响。仅存取, 不做缓存 — 状态一致性由前端 settings store 负责。

use error::Result;
use keyring::Entry;

use error::AiError;
use serde::Serialize;
#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};

/// Secret storage port owned by the backend AI host. Implementations never expose secrets through
/// status APIs; `resolve` is used only inside a provider request.
pub trait SecretStore: Send + Sync {
    fn resolve(&self, adapter: &str) -> Result<Option<String>>;
    fn status(&self, adapter: &str) -> Result<SecretStatus>;
    fn set(&self, adapter: &str, secret: &str) -> Result<SecretStatus>;
    fn delete(&self, adapter: &str) -> Result<SecretStatus>;
}

/// System keyring with a read-only provider-specific environment fallback.
#[derive(Default)]
pub struct SystemSecretStore;

/// Debug 构建专用：从仓库根目录 `.env` 逐次读取，完全不访问系统钥匙串。
#[cfg(debug_assertions)]
pub struct DevEnvSecretStore {
    path: PathBuf,
}

#[cfg(debug_assertions)]
impl DevEnvSecretStore {
    pub(crate) fn new() -> Self {
        Self {
            path: Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../.env"),
        }
    }

    fn secret(&self, adapter: &str) -> Result<Option<String>> {
        let name = environment_name(adapter)?;
        let content = match std::fs::read_to_string(&self.path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        Ok(parse_dev_env(&content, &name))
    }
}

#[cfg(debug_assertions)]
impl Default for DevEnvSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(debug_assertions)]
fn parse_dev_env(content: &str, name: &str) -> Option<String> {
    let mut secret = None;
    for line in content.lines() {
        let trimmed = line.trim();
        let line = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != name {
            continue;
        }
        let value = value.trim();
        let value = if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            &value[1..value.len() - 1]
        } else {
            value
        };
        let value = value.trim();
        secret = (!value.is_empty()).then(|| value.to_string());
    }
    secret
}

#[cfg(debug_assertions)]
impl SecretStore for DevEnvSecretStore {
    fn resolve(&self, adapter: &str) -> Result<Option<String>> {
        self.secret(adapter)
    }

    fn status(&self, adapter: &str) -> Result<SecretStatus> {
        let configured = self.secret(adapter)?.is_some();
        Ok(SecretStatus {
            configured,
            source: configured.then_some(SecretSource::Environment),
            writable: false,
        })
    }

    fn set(&self, _adapter: &str, _secret: &str) -> Result<SecretStatus> {
        Err(AiError::DevEnvReadOnly.into())
    }

    fn delete(&self, _adapter: &str) -> Result<SecretStatus> {
        Err(AiError::DevEnvReadOnly.into())
    }
}

/// 钥匙串 service 标识。
const SERVICE: &str = "lissio";

/// 密钥来源。前端只获取状态，不获取明文。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretSource {
    Keyring,
    Environment,
}

/// 某个 provider 的密钥状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SecretStatus {
    pub configured: bool,
    pub source: Option<SecretSource>,
    pub writable: bool,
}

/// 将跨平台 keyring 错误映射为稳定的 AI 错误契约。
fn map_keyring_error(error: keyring::Error) -> AiError {
    let details = error.to_string();
    if is_access_denied(&error) {
        AiError::KeyringAccessDenied { details }
    } else {
        AiError::Keyring { details }
    }
}

/// macOS Security.framework 的认证失败与用户取消是明确的授权拒绝信号。
#[cfg(target_os = "macos")]
fn is_access_denied(error: &keyring::Error) -> bool {
    const ERR_SEC_AUTH_FAILED: i32 = -25_293;
    const ERR_SEC_USER_CANCELED: i32 = -128;

    let platform_error = match error {
        keyring::Error::PlatformFailure(source) | keyring::Error::NoStorageAccess(source) => {
            source.downcast_ref::<security_framework::base::Error>()
        }
        _ => None,
    };
    platform_error
        .is_some_and(|error| matches!(error.code(), ERR_SEC_AUTH_FAILED | ERR_SEC_USER_CANCELED))
}

#[cfg(not(target_os = "macos"))]
const fn is_access_denied(_error: &keyring::Error) -> bool {
    false
}

/// 适配器对应的钥匙串条目。
fn entry_for(service: &str, adapter: &str) -> Result<Entry> {
    // adapter 来自白名单注册表, 但作为账户名仍防御非控制字符
    let sanitized: String = adapter
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if sanitized.is_empty() {
        return Err(AiError::UnknownAdapter {
            adapter: adapter.to_string(),
        }
        .into());
    }
    Entry::new(service, &format!("ai-api-key-{sanitized}"))
        .map_err(map_keyring_error)
        .map_err(error::AppError::from)
}

fn entry(adapter: &str) -> Result<Entry> {
    entry_for(SERVICE, adapter)
}

/// 读取适配器的 API key;未设置返回 `None`。
///
/// # Errors
/// 钥匙串访问失败 ([`AiError::Keyring`]) 或用户拒绝授权
/// ([`AiError::KeyringAccessDenied`])。
fn get_keyring(adapter: &str) -> Result<Option<String>> {
    match entry(adapter)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(map_keyring_error(e).into()),
    }
}

/// 写入适配器的 API key (已存在则覆盖)。
///
/// # Errors
/// 钥匙串访问失败 ([`AiError::Keyring`]) 或用户拒绝授权
/// ([`AiError::KeyringAccessDenied`])。
fn set_keyring(adapter: &str, key: &str) -> Result<()> {
    entry(adapter)?
        .set_password(key)
        .map_err(map_keyring_error)
        .map_err(error::AppError::from)
}

/// 删除适配器的 API key (不存在时静默)。
///
/// # Errors
/// 钥匙串访问失败 ([`AiError::Keyring`]) 或用户拒绝授权
/// ([`AiError::KeyringAccessDenied`])。
fn delete_keyring(adapter: &str) -> Result<()> {
    match entry(adapter)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(map_keyring_error(error).into()),
    }
    Ok(())
}

fn environment_name(adapter: &str) -> Result<String> {
    let normalized: String = adapter
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    if normalized.is_empty() {
        return Err(AiError::UnknownAdapter {
            adapter: adapter.to_string(),
        }
        .into());
    }
    Ok(format!("LISSIO_AI_API_KEY_{normalized}"))
}

fn environment_secret(adapter: &str) -> Result<Option<String>> {
    let name = environment_name(adapter)?;
    Ok(std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn choose_secret<E>(
    keyring: std::result::Result<Option<String>, E>,
    environment: Option<String>,
) -> std::result::Result<Option<String>, E> {
    match keyring {
        Ok(Some(secret)) => Ok(Some(secret)),
        Ok(None) => Ok(environment),
        Err(_) if environment.is_some() => Ok(environment),
        Err(error) => Err(error),
    }
}

fn choose_status<E>(
    keyring: std::result::Result<Option<String>, E>,
    environment: Option<String>,
) -> std::result::Result<SecretStatus, E> {
    match keyring {
        Ok(Some(_)) => Ok(SecretStatus {
            configured: true,
            source: Some(SecretSource::Keyring),
            writable: true,
        }),
        Ok(None) => Ok(environment.map_or(
            SecretStatus {
                configured: false,
                source: None,
                writable: true,
            },
            |_| SecretStatus {
                configured: true,
                source: Some(SecretSource::Environment),
                writable: true,
            },
        )),
        Err(_) if environment.is_some() => Ok(SecretStatus {
            configured: true,
            source: Some(SecretSource::Environment),
            writable: false,
        }),
        Err(error) => Err(error),
    }
}

/// 解析有效密钥：钥匙串优先，缺项或钥匙串不可用时读取 provider 专属环境变量。
fn get_secret(adapter: &str) -> Result<Option<String>> {
    choose_secret(get_keyring(adapter), environment_secret(adapter)?)
}

/// 返回不含明文的配置状态。
fn status(adapter: &str) -> Result<SecretStatus> {
    choose_status(get_keyring(adapter), environment_secret(adapter)?)
}

/// 覆盖钥匙串密钥。环境变量保持只读并由部署环境管理。
fn set_secret(adapter: &str, secret: &str) -> Result<SecretStatus> {
    if secret.trim().is_empty() {
        return delete_secret(adapter);
    }
    set_keyring(adapter, secret.trim())?;
    status(adapter)
}

/// 删除钥匙串条目；若存在环境变量，删除后会重新显露环境来源。
fn delete_secret(adapter: &str) -> Result<SecretStatus> {
    delete_keyring(adapter)?;
    status(adapter)
}

impl SecretStore for SystemSecretStore {
    fn resolve(&self, adapter: &str) -> Result<Option<String>> {
        get_secret(adapter)
    }

    fn status(&self, adapter: &str) -> Result<SecretStatus> {
        status(adapter)
    }

    fn set(&self, adapter: &str, secret: &str) -> Result<SecretStatus> {
        set_secret(adapter, secret)
    }

    fn delete(&self, adapter: &str) -> Result<SecretStatus> {
        delete_secret(adapter)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(debug_assertions)]
    use super::{DevEnvSecretStore, SecretStore, parse_dev_env};
    use super::{SecretSource, choose_secret, choose_status, environment_name, map_keyring_error};
    use error::{AiError, Error as _};

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
        let path = std::env::temp_dir().join(format!(
            "lissio-dev-secret-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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
}
