// 面板契约 reconcile — 注册表 (前端) × ModelCatalog.panels (后端) 的比对。
//
// 后端目录 fixture 由前端注册表条目反投影构造 (与
// `app::models::catalog::panel_descriptors` 同形), 因此「全部 ok」这条断言等价于
// 「前端镜像是后端契约的忠实副本」。随后逐项扰动, 验证每一类分歧都被抓住。

import { describe, expect, it } from 'vitest';
import {
  panelContractIssues,
  reconcilePanels,
  unsupportedPanels,
  type ReconciledPanel,
} from '../reconcile';
import { PANEL_DEFS, PANEL_DEFS_ORDERED } from '../../../../lib/panels/panelDefs';
import type { PanelDef } from '../../../../lib/panels/panelTypes';
import type { PanelDescriptor } from '../../../../types/generated/PanelDescriptor';
import type { PanelKind } from '../../../../types/generated/PanelKind';

/// 与后端投影同形的目录条目。
function backendDescriptor(def: PanelDef): PanelDescriptor {
  return {
    id: `panel:${def.panelKind}`,
    kind: def.panelKind,
    tabType: def.tabType,
    display: {
      labelKey: def.labelKey,
      fallbackLabel: def.panelKind,
      category: def.hostWidgetKind === null ? 'standalone' : 'derived',
      sortValue: 0,
    },
    ui: { rendererKey: null, editorKey: null, icon: null },
    hostWidgetKind: def.hostWidgetKind,
    configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
    dataPlane: def.dataPlane,
    binding: def.binding,
  };
}

function fullCatalog(): PanelDescriptor[] {
  return PANEL_DEFS_ORDERED.map(backendDescriptor);
}

function statusOf(panels: ReconciledPanel[], panelKind: string): string | undefined {
  return panels.find((panel) => panel.panelKind === panelKind)?.status;
}

describe('reconcilePanels', () => {
  it('目录未加载时不做比对 (不把「未知」当漂移)', () => {
    expect(reconcilePanels(undefined)).toEqual([]);
  });

  it('镜像一致时全部 ok', () => {
    const panels = reconcilePanels(fullCatalog());
    expect(panels).toHaveLength(12);
    expect(panels.every((panel) => panel.status === 'ok')).toBe(true);
    expect(unsupportedPanels(panels)).toEqual([]);
    expect(panelContractIssues(panels)).toEqual([]);
    // 顺序即后端目录顺序
    expect(panels.map((panel) => panel.panelKind)).toEqual(
      PANEL_DEFS_ORDERED.map((def) => def.panelKind)
    );
  });

  it('后端新增未知面板 → backend-only (unsupported 占位)', () => {
    const catalog = fullCatalog();
    catalog.push({
      ...backendDescriptor(PANEL_DEFS.pie),
      id: 'panel:future',
      kind: 'future-panel' as PanelKind,
      tabType: 'future',
      display: { labelKey: 'dataTabFuture', fallbackLabel: 'Future', sortValue: 12 },
    });
    const panels = reconcilePanels(catalog);
    const future = panels.find((panel) => panel.panelKind === 'future-panel');
    expect(future?.status).toBe('backend-only');
    expect(future?.def).toBeNull();
    expect(future?.tabType).toBe('future');
    expect(future?.labelKey).toBe('dataTabFuture');
    expect(unsupportedPanels(panels).map((p) => p.panelKind)).toEqual(['future-panel']);
  });

  it('前端有后端无 → frontend-only (报错, 无 UI 面)', () => {
    const catalog = fullCatalog().filter((descriptor) => descriptor.kind !== 'logic');
    const panels = reconcilePanels(catalog);
    const logic = panels.find((panel) => panel.panelKind === 'logic');
    expect(logic?.status).toBe('frontend-only');
    expect(logic?.descriptor).toBeNull();
    expect(logic?.def?.panelKind).toBe('logic');
    // 仅前端有的条目不进 unsupported 列表 (没有可渲染的后端身份)
    expect(unsupportedPanels(panels)).toEqual([]);
    expect(panelContractIssues(panels)).toEqual([
      'panel contract: 前端注册表声明了后端未下发的面板 logic',
    ]);
  });

  it('tabType 漂移 → mismatch', () => {
    const catalog = fullCatalog().map((descriptor) =>
      descriptor.kind === 'waveform' ? { ...descriptor, tabType: 'waveform-next' } : descriptor
    );
    const panels = reconcilePanels(catalog);
    expect(statusOf(panels, 'waveform')).toBe('mismatch');
    expect(panels.find((p) => p.panelKind === 'waveform')?.reason).toContain('tabType');
  });

  it('hostWidgetKind / labelKey 漂移 → mismatch', () => {
    const renamed = reconcilePanels(
      fullCatalog().map((descriptor) =>
        descriptor.kind === 'pie' ? { ...descriptor, hostWidgetKind: 'Pie' } : descriptor
      )
    );
    expect(statusOf(renamed, 'pie')).toBe('mismatch');
    expect(renamed.find((p) => p.panelKind === 'pie')?.reason).toContain('hostWidgetKind');

    const relabeled = reconcilePanels(
      fullCatalog().map((descriptor) =>
        descriptor.kind === 'can'
          ? { ...descriptor, display: { ...descriptor.display, labelKey: 'canFrames' } }
          : descriptor
      )
    );
    expect(statusOf(relabeled, 'can')).toBe('mismatch');
    expect(relabeled.find((p) => p.panelKind === 'can')?.reason).toContain('labelKey');
  });

  it('dataPlane 任一项漂移 → mismatch', () => {
    const cases: { patch: Partial<PanelDescriptor['dataPlane']>; field: string }[] = [
      { patch: { delivery: 'fetch' }, field: 'dataPlane.delivery' },
      { patch: { pushRequest: 'waveform_raster' }, field: 'dataPlane.pushRequest' },
      { patch: { fetchOp: 'waveform_window' }, field: 'dataPlane.fetchOp' },
      { patch: { defaultIntervalMs: 40 }, field: 'dataPlane.defaultIntervalMs' },
      { patch: { defaultMaxItems: 1 }, field: 'dataPlane.defaultMaxItems' },
    ];
    for (const { patch, field } of cases) {
      const panels = reconcilePanels(
        fullCatalog().map((descriptor) =>
          descriptor.kind === 'waveform'
            ? { ...descriptor, dataPlane: { ...descriptor.dataPlane, ...patch } }
            : descriptor
        )
      );
      expect(statusOf(panels, 'waveform'), field).toBe('mismatch');
      expect(panels.find((p) => p.panelKind === 'waveform')?.reason, field).toContain(field);
    }
  });

  it('binding 种类漂移 → mismatch; edgeBound 句柄不参与比对', () => {
    const singleton = reconcilePanels(
      fullCatalog().map((descriptor) =>
        descriptor.kind === 'raw' ? { ...descriptor, binding: { kind: 'singleton' } } : descriptor
      )
    );
    expect(statusOf(singleton, 'raw')).toBe('mismatch');
    expect(singleton.find((p) => p.panelKind === 'raw')?.reason).toContain('binding.kind');

    // 后端投影给出的真实端口句柄与前端声明的空数组不构成分歧
    const withHandles = reconcilePanels(
      fullCatalog().map((descriptor) =>
        descriptor.kind === 'waveform'
          ? { ...descriptor, binding: { kind: 'edgeBound', inputHandles: ['value', 'trigger'] } }
          : descriptor
      )
    );
    expect(statusOf(withHandles, 'waveform')).toBe('ok');
  });

  it('configBound 的字段名 / 模板漂移 → mismatch', () => {
    const panels = reconcilePanels(
      fullCatalog().map((descriptor) =>
        descriptor.kind === 'raw'
          ? {
              ...descriptor,
              binding: {
                kind: 'configBound',
                configKey: 'source',
                portTemplate: 'src:{source}:{handle}',
              },
            }
          : descriptor
      )
    );
    expect(statusOf(panels, 'raw')).toBe('mismatch');
    expect(panels.find((p) => p.panelKind === 'raw')?.reason).toContain('binding frontend=');
  });
});
