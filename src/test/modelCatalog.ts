//! 模型目录/文档准备测试辅助 — 统一的目录 fixture 与 prepare 响应桩。
//!
//! 目标: 测试不再各自手写目录对象; prepare 走 api 桩返回后端同形
//! PrepareOutcome (而不是恢复一套 TS 默认工厂)。

import { vi, type MockInstance } from 'vitest';
import type { ModelCatalog } from '../types/generated/ModelCatalog';
import type { ModelDescriptor } from '../types/generated/ModelDescriptor';
import type { ModelVariant } from '../types/generated/ModelVariant';
import type { JsonValue } from '../types/generated/serde_json/JsonValue';
import type { CatalogIssue, PrepareOutcome } from '../lib/models/createFromCatalog';
import type { NodeDocument } from '../lib/nodes/document';
import type { WidgetConfig } from '../types';
import { api } from '../lib/tauri/tauri';
import { useModelCatalogStore } from '../store/modelCatalogStore';

export const TEST_CATALOG_REVISION = 'rev-test';

/** 29 类控件 kind — 与后端 kind::widgets 注册表一致。 */
export const WIDGET_TEST_KINDS = [
  'Knob', 'Button', 'Radio', 'Checkbox', 'Slider', 'Label', 'Waveform',
  'PieChart', 'Image', 'Gauge', 'Progress', 'LED', 'NumberDisplay', 'Custom', 'Math',
  'Filter', 'FFT', 'IFFT', 'Spectrum', 'Model3D', 'Command', 'FrameDecoder',
  'TableView', 'RawData', 'Trigger', 'TextDisplay', 'TextInput', 'Str', 'TextOut',
] as const;

export function widgetDescriptor(kind: string, overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: `widget:${kind}`,
    family: 'widget',
    schemaVersion: 1,
    display: { fallbackLabel: kind, category: 'display', sortValue: 0 },
    ui: { rendererKey: kind, editorKey: kind, icon: null },
    configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
    defaultConfig: null,
    variants: [],
    actions: ['createNode', 'configure'],
    availability: { state: 'available', reason: null },
    ...overrides,
  };
}

export function variant(id: string, label: string, configPatch: Record<string, unknown>): ModelVariant {
  return {
    id,
    display: { fallbackLabel: label, category: 'variants', sortValue: 0 },
    configPatch: configPatch as JsonValue,
  };
}

export function makeCatalog(models: ModelDescriptor[]): ModelCatalog {
  return { contractVersion: 1, revision: TEST_CATALOG_REVISION, models };
}

/** 默认目录: 29 类 widget + 常用 protocol/driver/pointSelector 条目。 */
export function defaultTestCatalog(): ModelCatalog {
  const mathVariants = [
    variant('add', 'Math add', { op: 'add', inputCount: 2 }),
    variant('sub', 'Math sub', { op: 'sub', inputCount: 2 }),
    variant('sqrt', 'Math sqrt', { op: 'sqrt', inputCount: 1 }),
    variant('sin', 'Math sin', { op: 'sin', inputCount: 1 }),
  ];
  const strVariants = [
    variant('len', 'Str len', { op: 'len' }),
    variant('concat', 'Str concat', { op: 'concat' }),
  ];
  const filterVariants = [
    variant('Lowpass', 'Filter Lowpass', { preset: 'Lowpass' }),
    variant('Highpass', 'Filter Highpass', { preset: 'Highpass' }),
    variant('Bandpass', 'Filter Bandpass', { preset: 'Bandpass' }),
    variant('Bandstop', 'Filter Bandstop', { preset: 'Bandstop' }),
  ];
  const widgets = WIDGET_TEST_KINDS.map((kind) =>
    widgetDescriptor(kind, {
      variants:
        kind === 'Math' ? mathVariants : kind === 'Str' ? strVariants : kind === 'Filter' ? filterVariants : [],
    })
  );
  const protocols = ['JustFloat', 'FireWater', 'RawData', 'Slcan', 'CandleLight', 'LogicDecode'].map(
    (kind, index): ModelDescriptor => ({
      id: `protocol:${kind}`,
      family: 'protocol',
      schemaVersion: 1,
      display: { fallbackLabel: kind, category: 'protocol', sortValue: index },
      ui: { rendererKey: 'protocol', editorKey: 'protocol', icon: null },
      configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
      defaultConfig: { kind },
      variants: [],
      actions: ['createNode'],
      availability: { state: 'available', reason: null },
    })
  );
  return makeCatalog([
    ...widgets,
    ...protocols,
    {
      id: 'driver:serial',
      family: 'device',
      schemaVersion: 1,
      display: { fallbackLabel: 'serial', category: 'device', sortValue: 0 },
      ui: { rendererKey: 'acquisition', editorKey: 'acquisition', icon: null },
      configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
      defaultConfig: { port_name: '', baud_rate: 115200 },
      variants: [],
      actions: ['createNode'],
      availability: { state: 'available', reason: null },
    },
    {
      id: 'pointSelector',
      family: 'pointSelector',
      schemaVersion: 1,
      display: { fallbackLabel: 'Point Selector', category: 'structure', sortValue: 0 },
      ui: { rendererKey: 'point-selector', editorKey: 'point-selector', icon: null },
      configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
      defaultConfig: { points: [] },
      variants: [],
      actions: ['createNode'],
      availability: { state: 'available', reason: null },
    },
    {
      id: 'aiProvider:mock',
      family: 'aiProvider',
      schemaVersion: 1,
      display: { fallbackLabel: 'Mock AI', category: 'ai', sortValue: 0 },
      ui: { rendererKey: null, editorKey: null, icon: null },
      configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
      defaultConfig: { adapter: 'mock' },
      variants: [],
      actions: ['configure'],
      availability: { state: 'available', reason: null },
    },
  ]);
}

/** 把目录注入 store (ready 状态; 不 bump generation — 能力目录缓存不受影响)。 */
export function seedModelCatalogForTests(models: ModelCatalog = defaultTestCatalog()): void {
  useModelCatalogStore.setState({
    status: 'ready',
    revision: models.revision,
    contractVersion: models.contractVersion,
    byId: Object.fromEntries(models.models.map((m) => [m.id, m])),
    models: models.models,
    error: null,
  });
}

/** 桩掉 prepare RPC — 按 outcomes 顺序回放。 */
export function mockPrepareResponses(
  outcomes: PrepareOutcome[]
): MockInstance<typeof api.prepareNodeDocuments> {
  return vi
    .spyOn(api, 'prepareNodeDocuments')
    .mockResolvedValue({ results: outcomes, catalogRevision: TEST_CATALOG_REVISION });
}

/**
 * prepare RPC 回放桩 — 按请求 op 逐项回显最小合法文档, 默认值取自当前
 * seed 的目录 fixture (defaultConfig), 与 prepare 的 wire 合同一致:
 * 默认 → 变体 patch → configPatch。这是 RPC 边界的测试替身, 不是业务工厂;
 * 参数默认值/归一化语义由后端测试 (widgets/tests.rs) 保证。
 */
export function mockPrepareEcho(): MockInstance<typeof api.prepareNodeDocuments> {
  return vi.spyOn(api, 'prepareNodeDocuments').mockImplementation(((request: {
    operations: {
      op?: string;
      modelId?: string;
      variantId?: string | null;
      nodeId?: string;
      tabId?: string;
      label?: string | null;
      configPatch?: Record<string, unknown>;
    }[];
  }) => {
    const { byId } = useModelCatalogStore.getState();
    const results = (request.operations ?? []).map((op) => {
      const modelId = op.modelId ?? '';
      const model = byId[modelId];
      const nodeId = op.nodeId ?? 'node-test';
      const tabId = op.tabId ?? 'default';
      const layout = { x: 0, y: 0, width: null, height: null };
      const variantPatch = (() => {
        const variantId = op.variantId;
        if (!variantId) return {} as Record<string, unknown>;
        const variant = (model?.variants ?? []).find((v) => v.id === variantId);
        return (variant?.configPatch ?? {}) as Record<string, unknown>;
      })();
      if (modelId.startsWith('protocol:')) {
        const base = (model?.defaultConfig ?? { kind: modelId.slice('protocol:'.length) }) as Record<string, unknown>;
        const protocol = {
          ...base,
          ...((op.configPatch as { protocol?: Record<string, unknown> } | undefined)?.protocol ?? {}),
        } as never;
        return {
          status: 'ok',
          document: {
            id: nodeId, tabId, label: op.label ?? (typeof base.kind === 'string' ? base.kind : 'Protocol'), layout, kind: 'protocol',
            config: { protocol, convertTo: null, schema: { preset: 'custom', legacyConfig: null, decode: [] } },
          },
          issues: [],
        };
      }
      if (modelId.startsWith('driver:')) {
        const driverId = modelId.slice('driver:'.length);
        const patch = (op.configPatch ?? {}) as {
          capabilityEndpointId?: string;
          config?: Record<string, unknown>;
        };
        const config = { ...((model?.defaultConfig ?? {}) as Record<string, unknown>), ...(patch.config ?? {}) };
        return {
          status: 'ok',
          document: {
            id: nodeId, tabId, label: op.label ?? driverId, layout, kind: 'device',
            config: {
              node: {
                id: nodeId,
                name: op.label ?? driverId,
                driver: driverId,
                schemaVersion: model?.schemaVersion ?? 1,
                config,
                enabled: true,
                capabilityEndpointId: patch.capabilityEndpointId ?? null,
                children: [],
              },
            },
          },
          issues: [],
        };
      }
      const kind = modelId.startsWith('widget:') ? modelId.slice('widget:'.length) : modelId;
      const params: Record<string, unknown> = {
        ...variantPatch,
        ...((op.configPatch ?? {})),
        id: nodeId,
        label: op.label ?? kind,
      };
      return {
        status: 'ok',
        document: {
          id: nodeId, tabId, label: (params.label as string) ?? kind, layout, kind: 'widget',
          config: { widgetKind: kind, params, customPorts: null },
        },
        issues: [],
      } as unknown as PrepareOutcome;
    });
    return Promise.resolve({ results, catalogRevision: TEST_CATALOG_REVISION });
  }) as never);
}

/** 构造一个 ok 的 widget prepare outcome (与后端 PrepareOutcome wire 同形)。 */
export function widgetOutcome(
  kind: WidgetConfig['kind'],
  params: Record<string, unknown> = {},
  issues: CatalogIssue[] = []
): PrepareOutcome {
  const { id, label, ...rest } = params;
  const document: NodeDocument = {
    id: typeof id === 'string' ? id : 'node-test',
    tabId: 'default',
    label: typeof label === 'string' ? label : kind,
    layout: { x: 0, y: 0, width: null, height: null },
    kind: 'widget',
    config: { widgetKind: kind, params: rest, customPorts: null },
  };
  return { status: 'ok', document, issues };
}
