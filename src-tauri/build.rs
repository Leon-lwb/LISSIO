fn main() {
    tauri_build::build();
    remove_tauri_msvcrt_stub().expect("failed to remove Tauri's empty MSVC library stub");
}

fn remove_tauri_msvcrt_stub() -> std::io::Result<()> {
    // tauri-build 2.7.2 writes this empty COFF object for static CRT linking.
    // Cargo also gives its search path to unrelated doctests, which need the
    // real SDK library. Keep Tauri's explicit CRT link arguments, removing only
    // the exact upstream placeholder after it has been generated.
    const EMPTY_COFF: &[u8] = &[
        1, 0, 94, 3, 96, 98, 60, 0, 0, 0, 1, 0, 0, 0, 0, 0, 132, 1, 46, 100, 114, 101, 99, 116,
        118, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 10, 16, 0, 46, 100, 114, 101, 99, 116, 118, 101, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 4, 0,
        0, 0,
    ];
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return Ok(());
    }
    let out_dir = std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR");
    let path = std::path::PathBuf::from(out_dir).join("msvcrt.lib");
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    if bytes.len() == EMPTY_COFF.len() + 2
        && matches!(&bytes[..2], [0x64, 0x86] | [0x4c, 0x01])
        && bytes[2..] == *EMPTY_COFF
    {
        std::fs::remove_file(path)?;
    }
    Ok(())
}
