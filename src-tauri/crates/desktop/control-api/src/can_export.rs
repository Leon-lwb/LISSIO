//! CAN 负载 CSV — 采样快照 → CSV 文本与默认文件名的共享实现。
//!
//! 原实现私有于 Tauri 命令层 (`commands/can_load`), Web 出口需要同一条命令
//! (`export_can_load_csv`), 因此把纯格式化部分下沉 (P3)。
//!
//! 落盘位置策略仍由各出口决定, 不在这里: 桌面把产物写进用户下载目录 (Tauri
//! `AppHandle`), Web 出口写进受管暂存区并回下载链接 (浏览器没有可写路径)。

use can::CanLoadSnapshot;

/// 将 UNIX 秒数转换为本地时间组件 (年月日时分秒)
/// 简化实现, 不依赖 chrono — 时区取自操作系统当前设置
#[allow(clippy::cast_possible_wrap, clippy::cast_sign_loss)] // unix 秒值域远小于 c_long 上限, tm 字段均为非负小整数
#[must_use]
pub fn secs_to_local_components(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    // 用 libc localtime_r 获取本地时间
    #[cfg(unix)]
    {
        use std::os::raw::{c_char, c_int, c_long};
        unsafe extern "C" {
            fn localtime_r(time: *const c_long, result: *mut libc_tm) -> *mut libc_tm;
        }
        #[repr(C)]
        struct libc_tm {
            tm_sec: c_int,
            tm_min: c_int,
            tm_hour: c_int,
            tm_mday: c_int,
            tm_mon: c_int,
            tm_year: c_int,
            tm_wday: c_int,
            tm_yday: c_int,
            tm_isdst: c_int,
            tm_gmtoff: c_long,
            tm_zone: *const c_char,
        }
        let t: c_long = secs as c_long;
        let mut tm = libc_tm {
            tm_sec: 0,
            tm_min: 0,
            tm_hour: 0,
            tm_mday: 0,
            tm_mon: 0,
            tm_year: 0,
            tm_wday: 0,
            tm_yday: 0,
            tm_isdst: 0,
            tm_gmtoff: 0,
            tm_zone: std::ptr::null(),
        };
        // SAFETY: `t` 指向本函数初始化的有效 c_long,`tm` 是已清零初始化的
        // libc_tm;localtime_r 仅写入 tm,按 POSIX 不修改全局状态(线程安全)。
        unsafe {
            localtime_r(&raw const t, &raw mut tm);
            (
                (tm.tm_year + 1900) as u32,
                (tm.tm_mon + 1) as u32,
                tm.tm_mday as u32,
                tm.tm_hour as u32,
                tm.tm_min as u32,
                tm.tm_sec as u32,
            )
        }
    }
    // Windows 没有 localtime_r, 用 Win32 时区 API 求含夏令时的本地时间
    #[cfg(target_os = "windows")]
    {
        windows_local_components(secs).unwrap_or_else(|| utc_components(secs))
    }
    // 其余平台既无 localtime_r 也无 Win32 API, 退回 UTC
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        utc_components(secs)
    }
}

/// Windows: 用 Win32 时区 API 把 UNIX 秒数换算成**本地**时间 (含夏令时)。
///
/// `FileTimeToSystemTime` 先把 FILETIME 拆成 UTC 的 `SYSTEMTIME`,
/// `SystemTimeToTzSpecificLocalTime` 再按当前系统时区转成本地时间。
/// 任一步失败返回 `None`, 由调用方退回 UTC 计算。
#[cfg(target_os = "windows")]
fn windows_local_components(secs: u64) -> Option<(u32, u32, u32, u32, u32, u32)> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};

    /// 1601-01-01 到 1970-01-01 的秒数 (FILETIME 与 UNIX 的纪元差)。
    const EPOCH_DIFF_SECS: u64 = 11_644_473_600;
    /// FILETIME 以 100ns 为单位。
    const TICKS_PER_SEC: u64 = 10_000_000;

    let ticks = secs
        .checked_add(EPOCH_DIFF_SECS)?
        .checked_mul(TICKS_PER_SEC)?;
    let utc_file_time = FILETIME {
        dwLowDateTime: u32::try_from(ticks & 0xffff_ffff).ok()?,
        dwHighDateTime: u32::try_from(ticks >> 32).ok()?,
    };

    let mut utc = zeroed_system_time();
    // SAFETY: 两个参数都指向本函数内已初始化的有效结构。
    if unsafe { FileTimeToSystemTime(&raw const utc_file_time, &raw mut utc) } == 0 {
        return None;
    }

    let mut local = zeroed_system_time();
    // SAFETY: null 表示使用当前系统时区; utc/local 均为本函数内的有效结构。
    if unsafe { SystemTimeToTzSpecificLocalTime(std::ptr::null(), &raw const utc, &raw mut local) }
        == 0
    {
        return None;
    }

    Some((
        u32::from(local.wYear),
        u32::from(local.wMonth),
        u32::from(local.wDay),
        u32::from(local.wHour),
        u32::from(local.wMinute),
        u32::from(local.wSecond),
    ))
}

/// `SYSTEMTIME` 的零值起点 — Win32 只用它写出结果。
#[cfg(target_os = "windows")]
const fn zeroed_system_time() -> windows_sys::Win32::Foundation::SYSTEMTIME {
    windows_sys::Win32::Foundation::SYSTEMTIME {
        wYear: 0,
        wMonth: 0,
        wDayOfWeek: 0,
        wDay: 0,
        wHour: 0,
        wMinute: 0,
        wSecond: 0,
        wMilliseconds: 0,
    }
}

/// 无时区 API 可用时的 UTC 回退 (Win32 换算失败也走这里)。
#[cfg(not(unix))]
#[allow(clippy::cast_possible_truncation)] // 日/时/分/秒均为有界小整数, 不会截断
fn utc_components(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let days = secs / 86_400;
    let sec_of_day = secs % 86_400;
    let hour = (sec_of_day / 3_600) as u32;
    let minute = ((sec_of_day % 3_600) / 60) as u32;
    let second = (sec_of_day % 60) as u32;
    // 简化日期计算 (从 1970-01-01 开始)
    let mut year = 1970u32;
    let mut remaining_days = days as u32;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }
    let days_per_month = [
        31,
        if is_leap_year(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u32;
    for &days_in_month in &days_per_month {
        if remaining_days < days_in_month {
            break;
        }
        remaining_days -= days_in_month;
        month += 1;
    }
    (year, month, remaining_days + 1, hour, minute, second)
}

#[cfg(not(unix))]
const fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// 默认导出文件名 `vofa-can-load-YYYYMMDD-HHMMSS.csv`。
#[must_use]
pub fn can_load_csv_file_name(secs: u64) -> String {
    let (yyyy, mm, dd, hh, min, ss) = secs_to_local_components(secs);
    format!("vofa-can-load-{yyyy:04}{mm:02}{dd:02}-{hh:02}{min:02}{ss:02}.csv")
}

/// CSV 元信息头里的导出时刻 `YYYY-MM-DDTHH:MM:SS`。
#[must_use]
pub fn can_load_export_time(secs: u64) -> String {
    let (yyyy, mm, dd, hh, min, ss) = secs_to_local_components(secs);
    format!("{yyyy:04}-{mm:02}-{dd:02}T{hh:02}:{min:02}:{ss:02}")
}

/// 格式化 CanLoadSnapshot 为 CSV 字符串。
#[must_use]
pub fn format_can_load_csv(snap: &CanLoadSnapshot, bitrate: u32, export_time: &str) -> String {
    use std::fmt::Write as _;
    let mut s = String::with_capacity(8192);
    // 元信息头
    s.push_str("# Lissio CAN Load Stats Export\n");
    // String 的 write! 实现不会失败, 直接忽略返回值
    let _ = writeln!(s, "# Export Time: {export_time}");
    let _ = writeln!(s, "# Bitrate: {bitrate} bps");
    let window_desc = if snap.window_us >= 1_000_000 {
        format!("{}s", snap.window_us / 1_000_000)
    } else {
        format!("{}ms", snap.window_us / 1000)
    };
    let _ = writeln!(s, "# Window: {} us ({window_desc})", snap.window_us);
    let _ = writeln!(
        s,
        "# Summary: frames={}, total_bits={}, total_bytes={}, load_ratio={:.4}",
        snap.frame_count, snap.total_bits, snap.total_bytes, snap.load_ratio
    );
    s.push('\n');

    // Section: History
    s.push_str("# Section: History\n");
    s.push_str("timestamp_us,load_ratio,fps\n");
    for p in &snap.history {
        let _ = writeln!(s, "{},{:.6},{:.2}", p.timestamp, p.load_ratio, p.fps);
    }
    s.push('\n');

    // Section: Per-ID
    s.push_str("# Section: Per-ID\n");
    s.push_str("id_hex,extended,frame_count,total_bits,total_bytes\n");
    for id_stat in &snap.per_id {
        let _ = writeln!(
            s,
            "0x{:X},{},{},{},{}",
            id_stat.id,
            id_stat.extended,
            id_stat.frame_count,
            id_stat.total_bits,
            id_stat.total_bytes
        );
    }
    s.push('\n');

    // Section: Per-ID History
    s.push_str("# Section: Per-ID History\n");
    s.push_str("id_hex,extended,timestamp_us,load_ratio\n");
    for h in &snap.per_id_history {
        for p in &h.history {
            let _ = writeln!(
                s,
                "0x{:X},{},{},{:.6}",
                h.id, h.extended, p.timestamp, p.load_ratio
            );
        }
    }

    s
}

#[cfg(test)]
#[path = "can_export_tests.rs"]
mod tests;
