//! # buffer_graph
//!
//! 节点连接边 — [`Edge`] (source/target + handle)。
//!
//! 图路由与环检测由 L1 `hir::TypedGraph` 与 `plane::BytePlan` 拥有; 本 crate 只
//! 提供它们共用的边类型, 不再保留并行的 `NodeGraph`/`RoutedData` 模型 (生产路径
//! 从未使用, 只有自身测试与基准在维护它们)。
mod edge;

pub use edge::Edge;
