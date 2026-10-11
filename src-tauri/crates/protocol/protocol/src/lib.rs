//! 协议引擎核心 — ProtocolEngine trait 与跨协议统一的输入/输出容器
//!
//! 子模块:
//!
//! - `traits`: `ProtocolEngine` trait + `InputFormat` + `ParsedInput` + `FeedOutput`
//! - `parse`: 输入字符串解析自由函数 (`parse_hex` / `parse_ascii` / `detect_format`)
//! - `split`: 帧边界并行切分算法 (`split_at_boundaries`)
//! - `text` / `buffer`: 文本回退编码与解析缓冲上限

pub mod buffer;
pub mod parse;
pub mod split;
pub mod text;
pub mod traits;

pub use parse::{detect_format, parse_ascii, parse_hex};
pub use split::split_at_boundaries;
pub use traits::{FeedOutput, InputFormat, ParsedInput, ProtocolEngine};
