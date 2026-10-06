# 共享模型合同清单

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/architecture/shared-model-inventory.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

本清单登记前后端共享业务模型的当前 owner、wire 来源和消费边界。运行时目录与
创建/描述合同见 [`backend-model-catalog-plan.md`](backend-model-catalog-plan.md)，
实现与验证说明见
[`shared-model-catalog-progress.md`](shared-model-catalog-progress.md)。

wire 拼写以 Rust owner 的 serde/ts-rs 定义和 `src/types/generated/` 为准；前端不再
保存第二份业务类型定义。

## 1. 图文档与派生

| 模型 | Rust owner | wire / 命令 | 前端消费 |
|---|---|---|---|
| `NodeDocument` | `kind::document` | `id/tabId/label/layout` + tagged `kind`/`config` | 图编辑、AI、模板、导入导出 |
| `Edge` | `flow` / `graph_ops` | `source/target/sourceHandle/targetHandle` | 图提交与拓扑描述 |
| `GraphDerived` | `graph_ops::derived` | `nodes[].ports`、`version` 与完整描述字段 | `graph:derived` 事件和派生端口 |
| `NodeDescription` | `app::models::describe` | 输入/输出、默认 handle、动态口、issues | `describeStore` 与节点注册表 |
| `SourceNodeHint` | `app::models::describe` | `defaultInput` 等拓扑提示 | RawData 路由和连线校验 |

ReactFlow 适配层可使用 `point-selector`；wire 业务 kind 保持 `pointSelector`。

## 2. 控件与运算

| 模型 | Rust owner | wire / 命令 | 前端消费 |
|---|---|---|---|
| 29 类 widget 配置 | `kind::widgets` | `widgetKind` + 生成的参数判别联合 | 编辑器、渲染器、AI、模板 |
| Widget variants | `kind::widgets` | `ModelDescriptor.variants` | 调色板与创建服务 |
| `MathOp` / `StrOp` | `kind::math_op` / `kind::str_op` | lowercase / `encode_hex` | 属性编辑与描述 |
| DSP 参数 | `filter` / `spectrum` / `waveform` owner | camelCase wire | 属性编辑与图提交 |
| `CommandConfig` / decoder blocks | `schema_types` / `frame-decoder` | blocks 数组 | 命令发送与帧解码 |

`WIDGET_REGISTRY` 只拥有 renderer/editor/icon 等 UI 注册，不定义默认参数、端口或
lowering。

## 3. 设备、协议与仿真

| 模型 | Rust owner | wire / 命令 | 前端消费 |
|---|---|---|---|
| `NodeDecl` / `NodeId` / `NodePath` | `data-model::device_tree` | camelCase | 设备树画布、配置和持久化 |
| `DriverProjection` | `device-tree::registry` | `list_driver_manifests` | 驱动目录与创建表单 |
| `AdapterCapability` / endpoint / ports | `acquisition` / `device-tree` | `list_adapter_capabilities` | 能力卡片与设备面板 |
| `ConfigurationSchema` | `data-model::model_descriptor` | JSON Schema 子集 + UI hints | schemaForm |
| `SimulationConfig` / `SignalParameters` | `data-model::device` | camelCase | 仿真表单 |
| Protocol presets / schema | `schema_types` | `ProtocolConfig` / `SchemaFrame` | 协议表单、端口与预设创建 |

## 4. AI provider

`llm::types` 是 adapter 能力与解析的权威来源；`app::models::build_model_catalog`
投影 provider 配置 schema、默认 URL、是否需要自定义 URL/密钥。目录不包含密钥，
模型名称保持用户输入。

## 5. RPC、事件与数据 DTO

| 模型组 | 主要 owner | 消费边界 |
|---|---|---|
| RPC request/response | `rpc-api` 与各 domain owner | `src/types/generated/` |
| Event payload | `events`、`graph_ops`、`app` | `src/store/slices/events.ts` |
| Frames / waveform / raw data | `data-model`、`waveform`、`stream` | buffers 与 displays |
| CAN / logic | `can`、`logic`、`can-transport` | CAN/逻辑视图与发送 |
| Recording / workspace / settings | `recording`、`app`、`backend-server` | 面板、设置和持久化 |
| Structured errors | `error` / `rpc-api::args` | `errorGuidance` 与错误展示 |

## 6. 创建入口

所有入口最终调用 `prepare_node_documents`，并通过
`src/lib/models/createFromCatalog.ts` 生成 `NodeDocument`：

| 入口 | 当前路径 |
|---|---|
| 启动 RawData 种子 | `src/lib/models/startupSeed.ts` |
| 新建控制页 | `src/store/slices/controlTabs.ts` |
| 控件面板点击/拖放 | `src/lib/utils/paletteCreation.ts` |
| AI 创建节点 | `src/lib/ai/toolHost.ts` |
| 快速开始模板 | `src/lib/quickstart/` |
| 测试数据 | golden fixtures + `mockPrepareEcho` |

## 7. 开放 JSON 边界

- `NodeBusiness::Widget.params` 使用生成的已知判别联合；未知 kind 保留 JSON 并进入
  unsupported 展示。
- `ConfigurationSchema.ui_hints` 保持 `Value`，由 schemaForm 消费。
- `SimulationConfig.encoding` 是驱动开放载荷。
- `DriverPayload.payload` 是驱动私有配置信封。
- `rpc_api::dispatch` 的 `args` 是出口参数边界，具体命令由 DTO 解码。

## 8. 纯 UI 边界

控件颜色、图标、i18n key、显示常量、主题、布局、窗口偏好、React 组件、拖放和
属性面板交互保持在前端。

## 9. 已知边界

1. `validate_adapter_configuration` 只接收单个 `DriverPayload`，不能替代带真实父
   typed-port 合同的子驱动装配校验。
2. 表单支持项目约定的 JSON Schema 子集，不承诺任意 `$ref` / `oneOf` schema。
3. `minimum` 或数值 `0` 是约束，不自动成为业务默认值。
4. 未知模型/widget 必须显式 unsupported，不能索引缺失注册项或静默降级。