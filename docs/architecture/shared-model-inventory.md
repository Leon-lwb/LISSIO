# 共享模型合同清单

逐项登记前后端共享业务模型：前端符号、Rust owner、wire 名称、调用方与迁移去向。
本清单是 `backend-model-catalog-plan.md` 的基线产物；迁移完成后在对应行标注去向。
“纯 UI”条目不迁移，保持在前端。

wire 名称列给出线上 JSON 中的字段/枚举/命令拼写，均以当前实现为准。

## 1. 图文档与派生

| 前端符号 | 位置 | Rust owner | wire 名称 | 调用方 | 迁移去向 |
|---|---|---|---|---|---|
| `NodeDocument` | `src/lib/nodes/document.ts` | `kind::document::NodeDocument` | `id/tabId/label/layout` + tagged `kind`/`config` | `appStoreHelpers.syncTabGraphToBackend`、`toolHost`、`templates.ts`、`appExport` | 保留 NodeDocument 同步；TS 类型由 Rust 导出（`src/types/generated/`） |
| `Business.kind: 'pointSelector'` | `document.ts` | `NodeBusiness::PointSelector` | `pointSelector` | wire | 不变；ReactFlow 适配层类型保持 `point-selector`（`nodeDocument` 已修复拼写） |
| `Edge` | `src/store/slices/graph.ts` 等 | `graph_ops`/`flow` | `source/target/sourceHandle/targetHandle` | `update_tab_graph` | 随 NodeDocument 导出 |
| `GraphDerivedPayload` | `src/store/slices/derived.ts` | `graph_ops::derived::GraphDerived` | `nodes[].ports`（仅输出口）、`version` | `update_tab_graph` 响应、`graph:derived` 事件 | 增加可选完整描述字段；`ports` 输出语义不变 |
| `SourceNodeHintPayload` | `src/lib/tauri/tauri.ts` | `graph_ops::document`（default handle switch） | `defaultInput` 等 | `get_source_graph` | 由统一描述生成，删除独立 switch |

## 2. 控件（widget）

| 前端符号 | 位置 | Rust owner | wire 名称 | 调用方 | 迁移去向 |
|---|---|---|---|---|---|
| 29 类 `WidgetConfig` 联合 | `src/types/widgets.ts`、`frameDecoder.ts`、`common.ts` | 无（`NodeBusiness::Widget.params` 为 `Value`） | `widgetKind` 字符串 + JSON params | 编辑器、渲染器、AI、模板 | `kind` 注册参数结构并导出 TS 判别联合 |
| `createWidget(kind)` 默认工厂 | `src/lib/utils/widgetDefaults.ts` | 无 | — | palette 点击/拖放、`App.tsx` 种子、`controlTabs.addDefaultCanvas`、`toolHost`、`templates.ts` | `kind` 默认工厂（后端创建） |
| `normalizeWidgetConfig` | `src/lib/utils/widgetNormalize.ts` | 无 | — | `addWidget`/`updateWidget`、workspace hydrate、AI | `kind` 迁移/归一化（创建默认与历史迁移分开） |
| `WidgetPorts.getWidgetPorts` | `src/components/nodes/WidgetPorts.ts` | `kind::ports::port_table`（仅内部 kind） | handle 字符串 | 节点注册表 ports 回调、连线 | 读 `describe_node_documents` 的 NodeDescription |
| `STR_OP_PORTS`、`isUnaryMathOp`、`computeMathResult` | `src/types/common.ts` | `kind::str_op`、`kind::math_op` | op 小写字符串 | WidgetPorts、属性编辑器 | 从后端定义导出元数据；`computeMathResult` 待确认生产调用后处理 |
| `MathOp`/`StrOp` 枚举 | `src/types/common.ts` | `kind::math_op::MathOp`、`kind::str_op::StrOp` | lowercase / `encode_hex` | 编辑器 | 生成导出 |
| `FilterPresetKind`、`FFTConfig` 等 DSP 参数 | `src/types/common.ts` | `graph`/`filter`/`spectrum` 相关 owner | camelCase | 编辑器 | 随各自 owner 导出 |
| `WIDGET_REGISTRY` | `src/components/widgets/registry.ts` | 无 | — | 渲染分发 | 保留为 UI registry（renderer/editor/icon） |
| `CommandConfig` 归一化 | `src/lib/utils/commandFrames.ts` | `frame-decoder`/`schema` 部分校验 | blocks 数组 | 编辑器、发送 | 归一化迁移后端，执行保留 |

## 3. 设备与适配器

| 前端符号 | 位置 | Rust owner | wire 名称 | 调用方 | 迁移去向 |
|---|---|---|---|---|---|
| `AdapterCapability`/`EndpointDescriptor`/`PortDescriptor`/`ConfigurationSchema` | `src/types/acquisition.ts` | `acquisition::capabilities` | camelCase | `capabilityCatalog.ts`、设备面板 | 生成导出 |
| `DriverManifestProjection` | `src/types/acquisition.ts` | `device_tree::DriverProjection` | camelCase | `list_driver_manifests` | 保留 owner；通用目录走 ModelDescriptor |
| `DeviceTreeNodeDecl` | `src/types/acquisition.ts` | `data_model::device_tree::NodeDecl` | camelCase | 设备树画布、文档 | 生成导出 |
| `SimulationConfig`/`SignalParameters` | `src/types/acquisition.ts` | `data_model::device::SimulationConfig` | camelCase | 仿真表单 | schema/默认/校验由后端提供，前端读目录 |
| `loadAdapterCapabilities`（模块级 Promise 缓存） | `src/lib/acquisition/capabilityCatalog.ts` | — | `list_adapter_capabilities` | palette、设备卡片 | 纳入连接生命周期（generation 隔离） |
| `validate_adapter_configuration` 调用 | `src/lib/tauri/tauri.ts` | `rpc-api::acquisition` → device-tree validate | 同名命令 | 设备表单 | 子驱动校验需真实父合同（生产实现 `parent=None` 问题待修） |

## 4. 协议

| 前端符号 | 位置 | Rust owner | wire 名称 | 调用方 | 迁移去向 |
|---|---|---|---|---|---|
| `ProtocolConfig`（JustFloat/FireWater/RawData/Slcan/CandleLight/LogicDecode/Diagnostic） | `src/types/transport.ts` | `schema_types::ProtocolConfig` | tag `kind`，kebab 只在 bytes 族 | `appStoreHelpers.DEFAULT_PROTOCOL_CONFIG`、模板、AI | 生成导出；预设工厂迁后端 |
| `SchemaPreset`/`ProtocolSchema`/`EncodeBlock` | `src/types/protocolSchema.ts` | `schema_types::ProtocolSchema` | `preset/legacyConfig/decode` | 协议属性编辑器 | 生成导出 |
| `justfloatSchema` 等 6 个预设工厂、`DEFAULT_PRESET_CHANNELS` | `src/lib/utils/protocolSchema.ts` | 无（前端组装） | decode blocks | 所有协议创建入口 | `schema_types` 预设工厂 |
| `schemaPortNames`/`protocolPortNames`/`getEffectiveChannels` | `src/lib/utils/protocolSchema.ts` | `schema_types::ProtocolSchema::port_names` 部分 | handle 字符串 | 端口推导 | 统一由后端描述推导 |
| `DecoderBlock`/`CommandBlock`/`FieldType` | `src/types/frameDecoder.ts` | `schema_types::decoder_block`、`frame-decoder` | `type` tag | 解码编辑器、Command | 生成导出 |

## 5. AI provider

| 前端符号 | 位置 | Rust owner | wire 名称 | 调用方 | 迁移去向 |
|---|---|---|---|---|---|
| 14 项 adapter 选项 | `src/components/settingFields.ts` | `llm::types::ADAPTERS` | `adapter` 字符串 | AI 设置表单 | 目录提供（含 `openai_responses` 兼容项核对） |
| `AiProviderConfig` | `src/types/ai.ts` | `llm::types::AiProviderConfig` | snake_case（例外） | 设置、chat | 生成导出 |
| 默认 baseUrl/是否需要密钥 | `settingFields.ts` | `AdapterInfo.default_base_url` | — | 表单占位 | 目录声明 |

## 6. RPC / 事件 / 数据 DTO（手写镜像清单）

| 前端符号 | 位置 | Rust owner | 备注 |
|---|---|---|---|
| `src/types/common.ts` `RawData`/`RawDataChunk` | `src/types/common.ts` | `data_model::frame` | base64 bytes |
| `RunState`/`RunSnapshot` | `src/types/common.ts` | `acquisition`/`app::run_ops` | |
| `PortInfo`/`ConnectionState`/`TransportStats` | `src/types/transport.ts` | `data_model::frame` | |
| `CanFrame` 族、`SlcanConfig`/`CandleConfig` | `src/types/can.ts` | `can`/`can-transport`/`data_model::config` | |
| `LogicSample` 族 | `src/types/logic.ts` | `logic` | |
| `WaveformWindow` 族、`ScopeConfig` | `src/types/waveform.ts` | `stream`/`data-model` 部分 | 含纯 UI 常量（TIME_BASES_SEC 等），需拆分 |
| recording/`PipelineConfig` 等 payload 接口 | `src/lib/tauri/tauri.ts` 内部 | `recording`/`pipeline` | 就地定义，迁移时提取 |
| 事件 payload（`graph:derived`、`graph:source`、transport 事件等） | `src/store/slices/events.ts` | `events`/`graph_ops`/`app` | 逐个登记后生成 |
| `NodeError`/`parseNodeError` | `src/types/errors.ts` | 结构化错误 owner（`error`/rpc `code/path/message/severity`） | 生成导出后对齐 |

### Value / 匿名 JSON 边界（当前无类型）

- `NodeBusiness::Widget.params`（Rust `Value`）— WP3 建 29 类参数结构。
- `ConfigurationSchema.ui_hints`（`Value`）— 保持原样，前端 schemaForm 消费。
- `SimulationConfig.encoding`（`Option<Value>`）— 仿真 WP 补枚举。
- `DriverPayload.payload`（`Value`）— 保留 open vocabulary。
- RPC `dispatch` 的 `args: Value` — 逐命令提取参数结构。

## 7. 创建入口（迁移目标登记 — 已全部完成，去向已回填）

| 入口 | 原文件 | 原默认来源（已删除） | 迁移去向 |
|---|---|---|---|
| 启动 RawData 种子 | `src/App.tsx` | `createWidget('RawData')` | `src/lib/models/startupSeed.ts` → `createNodeFromCatalog('widget:RawData')` |
| 新建控制页 | `src/store/slices/controlTabs.ts` | `createWidget('RawData')` + `seedInitialGraph` | `createNodeFromCatalog` + `seedInitialGraph`（结构经 `prepareAcquisitionNode`/`prepareProtocolDocument` 装配） |
| 添加/Custom | `src/store/slices/widgets.ts` | `createWidget` + `normalizeWidgetConfig` | `addCanvasNodes`（唯一写入路径）+ `createNodeFromCatalog('widget:Custom')`；参数草稿按用户输入保留，归一化由后端图提交执行 |
| 面板点击 | `src/components/panels/widgetPalette/CategoryPanel.tsx` | `createWidget` + Math/Str/Filter patch | `paletteCreation.addPaletteNode`；Math/Str/Filter 条目由目录 `model.variants` 生成（`paletteSections.tsx`） |
| 面板拖放 | `src/components/layout/NodeEditor.tsx` | 同上 | 同一 `addPaletteNode` 分发 |
| 结构节点 | `src/lib/utils/paletteCreation.ts` | 手工构造 | 协议/点位选择 → 目录 Create；设备 → `driver:*` Create + `capabilityEndpointId` configPatch + 能力卡片 decorate |
| AI 创建 | `src/lib/ai/toolHost.ts` | `createWidget`/`buildProtocolConfig` | `createNodeFromCatalog` + 目录 kind 校验（`catalogModelOrThrow`） |
| 快速开始 | `src/lib/quickstart/templates.ts`、`applyTemplate.ts` | `widget()` helper + `schemaFromProtocolConfig` | 模板声明 modelId/variant/configPatch，`prepareNodesFromCatalog` 批量产出；协议 schema 经 `prepareProtocolDocument` |
| 测试工厂 | `src/test/nodeDocuments.ts` | `createWidget`/`schemaFromProtocolConfig` | 后端 golden fixtures（`src/test/fixtures/*.json`，与 rpc-api/tests/fixtures 同源）+ `mockPrepareEcho`（wire 合同回放桩） |

## 8. 纯 UI（不迁移）

- `WIDGET_CATEGORY_COLORS`、图标映射、i18n 键 — `src/types/widgets.ts`、registry。
- `TIME_BASES_SEC`、`V_PER_DIV`、`DEFAULT_RENDER` 等显示常量 — `src/types/waveform.ts`。
- 主题、布局、窗口偏好 — `settingsStore`、`layoutStore`。
- React 组件、拖放、连接校验 UI、属性面板交互 — 全部前端。

## 9. 已确认边界（迁移完成后的状态）

1. ✅ `nodeDocument()` 的 point-selector 适配拼写已修复（ReactFlow `point-selector` → wire `pointSelector`），round-trip 测试 `src/lib/nodes/__tests__/documentRoundTrip.test.ts`。
2. ✅ 端口统一：registry.ports 全部读 describe_node_documents（协议节点保留 graph:derived 运行时检测优先）；默认 handle/动态口由描述携带。
3. ✅ `NodeKind::Sink` 一对多控件的端口解析在后端 describe（widgetKind + params）完成。
4. ✅ 默认 handle switch 单源化：`app::models::describe::default_handle_for`，graph_ops 委托。
5. `validate_adapter_configuration` 生产路径 `parent=None`，返回原 payload ≠ 归一化配置（后端既有语义，本次未改动）。
6. ✅ `capabilityCatalog.ts` 缓存以 modelCatalogStore.generation 为键，随连接隔离。
7. ✅ 启动屏障：目录 ready 前不挂载 App（不恢复工作区/不写空工作区）；RawData 种子经 prepare。
8. ✅ 未知 widget → UnsupportedNode / 属性面板受限提示，不崩溃、不降级。
9. 表单只支持简化 JSON Schema 子集；minimum/0 不是业务默认值（现状保持）。
