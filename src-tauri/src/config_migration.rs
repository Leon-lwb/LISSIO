//! One-way, non-destructive migration from the former application identifier.

use std::{fs, io, path::Path};

const LEGACY_IDENTIFIER: &str = "top.pengheng.vofa-next";
const FILES: [&str; 4] = [
    "settings.json",
    "workspace.json",
    "ai_chat_sessions.json",
    "mcp_servers.json",
];

/// Copies legacy state when the corresponding Lissio file does not exist.
///
/// The old directory is never modified. Each file is independent so a later
/// invocation can recover from a partial copy.
// clippy 误报: 私有根模块内的 pub(crate) 对 crate:: 路径访问是必需的 (private 会 E0603)
#[allow(clippy::redundant_pub_crate)]
pub(crate) fn migrate_legacy_config(target: &Path) -> io::Result<Vec<String>> {
    fs::create_dir_all(target)?;
    let Some(parent) = target.parent() else {
        return Ok(Vec::new());
    };
    let legacy = parent.join(LEGACY_IDENTIFIER);
    if legacy == target || !legacy.is_dir() {
        return Ok(Vec::new());
    }

    let mut migrated = Vec::new();
    for file_name in FILES {
        let source = legacy.join(file_name);
        let destination = target.join(file_name);
        if source.is_file() && !destination.exists() {
            fs::copy(source, destination)?;
            migrated.push(file_name.to_owned());
        }
    }
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::migrate_legacy_config;
    use std::fs;

    fn sandbox(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "lissio-config-migration-{name}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn migration_is_idempotent_and_new_state_wins() {
        let parent = sandbox("idempotent");
        let old = parent.join("top.pengheng.vofa-next");
        let new = parent.join("top.pengheng.lissio");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("settings.json"), "old").unwrap();
        fs::write(old.join("workspace.json"), "workspace").unwrap();
        fs::write(new.join("settings.json"), "new").unwrap();

        assert_eq!(migrate_legacy_config(&new).unwrap(), ["workspace.json"]);
        assert!(migrate_legacy_config(&new).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(new.join("settings.json")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(old.join("settings.json")).unwrap(),
            "old"
        );
        fs::remove_dir_all(parent).unwrap();
    }
}
