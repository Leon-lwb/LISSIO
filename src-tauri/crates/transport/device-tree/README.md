# device-tree

`device-tree` 持久化设备拓扑，并统一承载节点驱动契约、节点运行时能力投影、
能力闭环校验和子树生命周期。

本 crate 不依赖硬件或外部 SDK。适配器实现 `NodeDriver`，打开后返回
`NodeRuntime` 的 typed port 投影，再由组合根注入。架构约束见
`docs/architecture/device-tree.md`。

内置 `protocol-engine` 驱动采用版本 1 的 `schema_types::ProtocolNodeConfig`
（`protocol`、`convertTo`、`schema`）。协议节点必须挂在字节来源下，可挂在真实来源、
测试数据、字节仿真或另一协议节点下。驱动只投影父来源原始字节和子树生命周期；
解析后的数值、帧及转换字节由流水线从设备声明派生执行图产生。
关闭协议节点会取消它的字节订阅，不会关闭共享的父来源。

驱动目录包含 `childPolicy` 和配置默认值，前端可据此生成合法的节点装配表单。
