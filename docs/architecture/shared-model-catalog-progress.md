# 前后端共享模型统一 — 执行情况记录

本文是 `backend-model-catalog-plan.md` 的实施进度记录，供后续执行者接力。
每完成一个阶段请更新本文（保持"已完成/未完成/注意事项"三段结构）。

最后更新：2026-09-26（**全部工作包 WP1–WP8 完成**。前端创建入口全量迁移至
目录创建服务，端口与协议 schema 单一来源切到 describe/prepare，前端业务
默认/归一化/预设工厂与旧 lowering 已删除，check:model-catalog + CI 已接入。）

## 总体状态

| 工作包 | 状态 | 说明 |
|---|---|---|
| WP1 基线与合同清单 | ✅ 完成 | 清单文档、point-selector 修复、round-trip 测试 |
| WP2 共享描述合同与类型导出 | ✅ 完成 | ConfigurationSchema 迁移、ModelCatalog 合同、ts-rs 全管线、TS import 迁移、golden fixtures |
| WP3 控件与操作定义注册 | ✅ 完成 | kind::widgets 29 类注册表（默认/归一化/端口/lower），TS 参数导出 |
| WP4 协议/设备/仿真/AI 注册 | ✅ 完成 | schema_types 预设工厂、驱动 default_config、仿真 schema、AI provider 单源 |
| WP5 文档用例与统一 RPC | ✅ 完成 | 三命令 + 默认 handle 单源（CLI/MCP 走通用 dispatch，未单测透传） |
| WP6 前端目录生命周期 | ✅ 完成 | modelCatalogStore + createFromCatalog + 启动屏障 + describe 缓存 + capabilityCatalog 代际隔离 |
| WP7 前端 UI 与创建入口迁移 | ✅ 完成 | 全部创建入口走 createNodeFromCatalog；palette 变体来自目录；WIDGET_REGISTRY 纯 UI；UnsupportedNode；AI settings 从目录读取 |
| WP8 持久化与清理 | ✅ 完成 | 前端工厂/旧 lowering 删除；测试工厂换 golden fixtures；check:model-catalog + CI 接入 |

## 验证基线（本记录最后一次全量运行）

```text
cargo test --workspace        → 1322 passed, 0 FAILED
cargo clippy --workspace --all-targets → 0 error
cargo fmt --check             → 通过
cargo deny check              → 通过 (advisories/bans/licenses/sources)
pnpm typecheck                → 通过 (0 error)
pnpm lint:ci                  → 通过 (generated 目录已加入 eslint ignore)
pnpm test                     → 724 passed (117 文件)
pnpm build / pnpm build:web   → 通过 (vite 生产构建)
pnpm check:contracts          → 179 个合同文件一致
pnpm check:architecture       → 通过 (62 crates)
pnpm check:web-contract       → SUPPORTED 120 / DESKTOP_ONLY 9
pnpm check:deps               → 通过
pnpm check:model-catalog      → 通过 (fixtures/契约版本/29 类覆盖)
```

## 关键落点（后续执行者必读）

### 后端

- **共享 schema 容器**：`ConfigurationSchema` owner 是
  `data-model/src/model_descriptor.rs`（acquisition 不再转发；
  消费方 `use data_model::ConfigurationSchema`）。同文件还有
  `ModelCatalog`/`ModelDescriptor`/`NodePortDomain`（PascalCase wire，
  与历史 graph:derived 域拼写一致）/`NodePortDescriptor`/`ModelIssue`。
- **类型导出**：入口 `rpc-api/examples/export_contracts.rs`（显式导出，
  ~170 类型）；脚本 `scripts/generate-contracts.mjs` /
  `scripts/check-contracts.mjs`。输出 `src/types/generated/`。
  ts-rs=12.0.1，`TS_RS_LARGE_INT=number` 由脚本设置。
- **控件注册表**：`kind/src/widgets/`（29 类；默认参数/归一化/端口/lower
  单源；`widget_document::lower` 是薄委托；测试在 widgets/tests.rs）。
- **协议预设工厂**：`schema_types/src/preset.rs`；Diagnostic → custom+空 decode。
- **NodeDriver trait**：`display_name()` / `default_config(node_id)`
  是设备配置默认值的唯一来源（前端 palette 设备创建经 prepare 消费）。
- **app::models**（catalog/prepare/describe）+ RPC 三命令
  `get_model_catalog`/`prepare_node_documents`/`describe_node_documents`；
  错误 kind `CatalogRevisionMismatch` → 前端刷新目录重试。
  prepare Create 的 configPatch 语义：设备分支识别 `capabilityEndpointId`
  （能力端点绑定）与 `config`（配置补丁，合并进驱动 default_config）。

### 前端（本次接力的核心变化）

- **启动屏障**：`BackendConnectionGate` 内新增 `CatalogGate` —
  连接成功后目录 `loading/error/incompatible/ready` 分页渲染；
  **children（App）在目录 ready 前不挂载**，因此水合/图同步/空工作区写入
  均不会在目录失败时发生；error 页仅重拉目录。
- **目录 store**：`src/store/modelCatalogStore.ts`（generation 隔离 +
  envelope 校验 + incompatible 状态 + 迟到响应丢弃）。
- **能力目录代际隔离**：`src/lib/acquisition/capabilityCatalog.ts` 的
  模块级 Promise 以 `modelCatalogStore.generation` 为缓存键 —
  configure/disconnect 后旧连接数据不再复用。
- **describe 消费层**：`src/lib/models/describeStore.ts` —
  订阅 rfNodes/rfEdges 变化 → 60ms 防抖批量 describe → 按 nodeId 缓存
  `NodeDescription`；requestRevision 丢弃迟到响应；**pending 保留上一份
  描述**（端口不闪空）；`adopt` 为合并式，`pruneExcept` 在全图收敛后裁剪
  已删除节点。App 在 `workspaceReady` 时 `startDescribeSync()`。
- **唯一创建服务**：`src/lib/models/createFromCatalog.ts` —
  - `createNodeFromCatalog`（单个）/`batchCreateFromCatalog`（批量，一条
    撤销记录）/`prepareNodesFromCatalog`（只 prepare 不插入，种子/模板
    装配设备树用）；CreateOptions 支持 `nodeId`（模板稳定 id）、
    `label`（prepare 的 label 覆盖）、`decorate`（画布视图数据装配，
    不进文档）、`configPatch`。
  - `prepareProtocolDocument(config)` — 协议预设 schema 的唯一来源。
  - 本地写入统一走 `widgets slice addCanvasNodes`（数据窗口派生、
    输入初值、按节点类型派生撤销 opKey、tab 图同步）。
- **创建入口迁移（全部）**：
  - 启动 RawData 种子 → `src/lib/models/startupSeed.ts`（in-flight 去重 +
    空画布前置检查；结构部分仍由 `seedInitialGraph` 用 prepare 产物装配
    设备树）。
  - 新建控制页 `controlTabs.addDefaultCanvas` → prepare RawData + seed。
  - 面板点击/画布拖放 → `lib/utils/paletteCreation.addPaletteNode`
    单一分发：test-data / 设备 / 协议 / 点位选择 / 控件（含目录变体）。
    设备条目 = 目录 `driver:*` 创建 + `capabilityEndpointId` 经 configPatch
    + `decorate` 装配能力卡片数据（与工作区水合同一来源）。
  - palette 条目与变体：`paletteSections.tsx` 的 Math/Str/Filter 条目由
    目录 `model.variants` 生成；图标/文案映射是纯 UI，未命中映射的变体用
    目录 fallbackLabel 照常展示；`documentLabel`（变体 fallbackLabel）作
    prepare label 覆盖，画布节点名与历史一致（如 'Math add'）。
  - AI toolHost `add_node` widget/protocol/point-selector → 目录服务；
    kind 白名单校验改为目录查找（`catalogModelOrThrow`）。
  - 快速开始模板 `templates.ts` → 模板只声明 modelId/variant/configPatch
    与连线布局；文档批量 prepare 产出；设备树为显式场景声明（含仿真与
    协议子节点，protocol schema 来自 prepare）。
  - Custom 编辑器新建 → prepare `widget:Custom`（编辑器默认代码是 UI
    语义，常量在 `lib/widgets/customTemplate.ts`）。
  - 测试工厂 `src/test/nodeDocuments.ts` → 后端 golden fixtures
    （`src/test/fixtures/*.json` 与 rpc-api/tests/fixtures 同源），仅做
    id/tabId 重排；prepare 的测试替身 `mockPrepareEcho` 按 wire 合同
    （目录 defaultConfig → 变体 → configPatch）回放，不是业务工厂。
- **端口单一来源**：`registry.ts` 的 `ports` 全部改为读取 describe 缓存
  （协议节点保留 graph:derived 运行时检测优先）；`WidgetPorts.ts` 业务
  switch 已删除（`WidgetPortsView.ts` 只留视图类型）；RawData 动态
  `src:*` 口、Custom 声明口、Model3D 姿态口均随描述更新。
- **协议 schema 消费**：协议 kind/通道切换（`setProtocolNodeConfig`、
  DeviceTreeInspector、ProtocolConfigForm 重置预设）一律经
  `prepareProtocolDocument`；前端不再有 schema 工厂。
- **WIDGET_REGISTRY 纯 UI**：只含 renderer/editor/icon/labelKey。
  未知 widgetKind → `UnsupportedNode`（保留原始文档、可删除、不降级）；
  WidgetProperties 未知 kind → 受限提示。
- **AI settings**：`settingFields.buildSettingFields(models)` 的 provider
  选项来自目录 aiProvider 家族（14 项硬编码删除）。

### 已删除（WP8 清理，grep 确认无残留消费者）

- `src/lib/utils/widgetDefaults.ts`（createWidget/DEFAULT_CUSTOM_CODE 副本）
- `src/lib/utils/widgetNormalize.ts`（normalizeWidgetConfig/normalizeModel3DConfig）
- `src/lib/utils/protocolSchema.ts` 的预设工厂（justfloatSchema 等六个 +
  schemaFromProtocolConfig + protocolPortNames + getEffectiveChannels +
  DEFAULT_PRESET_CHANNELS）；文件保留 `schemaPortNames`（custom 块派生）
  与 `isRawDataPreset`（持久化数据判读）两个纯派生 helper。
- `src/lib/utils/nodeDef.ts` 的旧 NodeKind lowering（widgetToNodeKind、
  NodeKind/NodeDef DTO、makeProtocolSourceNodeDef/makeProtocolNodeDef、
  NodeFilterConfig）；保留 `rawDataPortId`、`edgeToGraphEdge`、
  新增 `customWidgetPortDeclaration`（NodeDocument.customPorts 的来源）。
- `types/common.ts` 的 `computeMathResult`（无生产消费者）。
- `types/common.ts` 的 `isUnaryMathOp`/`STR_OP_PORTS` 保留 — 仅剩 UI 表单
  与结果平面选择的呈现语义（Math 输入数编辑、Str 输入框布局），不再参与
  创建/端口/lowering。

## 已知偏差与注意事项

1. **NodeState wire 是 `connection_epoch`（snake_case）** — 生成类型为准。
2. **ts-rs 注意点**：`#[serde(default)]` Option → `field?: T|null`；
   transparent 手写 TS impl；serde-json → JsonValue 联合。
3. **设备条目创建走目录 + 能力端点混合路径**（有意设计，非回退）：
   文档由 prepare `driver:*` 产出（配置默认值来自驱动 default_config），
   而 capabilityEndpointId 与卡片/端口画布数据来自能力目录 —— 端口是
   运行时投影，prepare 的静态目录无法表达"用户点击的发现端点"。
4. **pending 端口瞬时为空**：新建/恢复节点在首份描述到达前端口表为空
   （新节点本无连线；已恢复节点的边不删除，描述到达后恢复渲染）。
   这是"端口唯一权威 = describe"的直接推论，见 describeStore 注释。
5. **仿真子节点仍是前端场景默认**（`defaultSimulation`）：仿真驱动是
   设备树子节点语义，不在目录暴露（与后端 catalog.rs 注释一致）；
   逻辑解码器参数切换的起始值同样属于表单编辑器语义。
6. **check:model-catalog 校验面**：golden fixtures、契约版本（Rust↔TS）、
   测试目录 fixture ↔ UI registry 的 29 类覆盖；ID/变体唯一与 lowering
   对应由后端 `ensure_valid` 在启动/测试时保证。
7. **eslint ignore `src/types/generated/**`**：生成代码不参与 lint，
   一致性由 check:contracts（与 Rust 同步生成）保证。

## 遗留清单

（计划内工作包已全部完成；以下为后续可选增强）

- MCP/CLI 对三命令的端到端透传实测（通用 dispatch 理论可用）。
- 真机 `pnpm dev:desktop` + Web + backend-server 手动走查
  （创建/编辑/连线/保存恢复/重连/未知模型/AI 设置）。
- e2e 级别的 HTTP-RPC 集成测试（rpc-api models_contract 只覆盖 serde 合同）。
- inventory 文档中与本次迁移无关的历史段落（各前端文件行号/清单）随
  后续重构自然过期，可按需整理。

## 未验证项（诚实声明）

- 真机手动验证未做（见上）。
- `pnpm test:e2e`（Playwright）未在本阶段运行。
