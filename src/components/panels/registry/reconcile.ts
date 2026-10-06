// ============ 数据面板契约 reconcile ============
//
// 前端注册表 (panelDefs.ts) 与后端目录 (ModelCatalog.panels) 的比对。注册表是
// 后端契约的**声明式镜像**: 两侧都是权威, 分歧必须显式暴露, 不能静默漂移。
//
// 三个分支 (与后端 `panel_spec::validate` 的边界一致):
//   1. 一致          → status 'ok', 正常渲染
//   2. 后端有前端无  → status 'backend-only' (后端更新), unsupported 占位
//   3. 前端有后端无  → status 'frontend-only' (前端更新), 报错 (无 UI 面)
// 另有 'mismatch' (双方都有但字段不一致) —— 它是分支 2 的严格版本, 同样走
// unsupported 占位 + 报错, 因为拼写不一致的面板与缺失面板对用户是同一种结果。
//
// 目录未加载 (尚未连接 / 老后端不下发 panels) 时不做任何比对 —— 此时「后端没有」
// 不构成漂移的证据。

import { useMemo } from 'react';
import { useModelCatalogStore } from '../../../store/modelCatalogStore';
import { PANEL_DEFS_ORDERED, panelDefForKind } from '../../../lib/panels/panelDefs';
import type { PanelDef } from '../../../lib/panels/panelTypes';
import type { PanelBinding } from '../../../types/generated/PanelBinding';
import type { PanelDataPlane } from '../../../types/generated/PanelDataPlane';
import type { PanelDescriptor } from '../../../types/generated/PanelDescriptor';

export type PanelContractStatus =
  /// 后端与前端声明一致 —— 正常渲染
  | 'ok'
  /// 后端声明了前端注册表不认识的面板 (后端更新) —— unsupported 占位
  | 'backend-only'
  /// 双方都认识但字段不一致 (契约漂移) —— unsupported 占位 + 报错
  | 'mismatch'
  /// 前端注册表声明了后端未下发的面板 (前端更新) —— 报错, 无 UI 面
  | 'frontend-only';

export interface ReconciledPanel {
  /// 后端面板身份 (wire 拼写)
  readonly panelKind: string;
  /// 前端登记的 tab 类型; 仅后端有时为该描述符的 tabType
  readonly tabType: string | null;
  /// 前端登记的 i18n 键; 仅后端时取描述符的 labelKey
  readonly labelKey: string | null;
  readonly status: PanelContractStatus;
  /// 后端下发的描述符; 仅前端有时为 null
  readonly descriptor: PanelDescriptor | null;
  /// 前端注册表条目; 仅后端有时为 null
  readonly def: PanelDef | null;
  /// status !== 'ok' 时的人类可读原因
  readonly reason: string | null;
}

/// wire 上的「无值」统一成 null —— 后端 `Option::None` 不下发字段, 前端省略字段。
function present(value: unknown): unknown {
  return value === undefined ? null : value;
}

function compareDataPlane(front: PanelDataPlane, back: PanelDataPlane): string[] {
  const diffs: string[] = [];
  const check = (field: keyof PanelDataPlane) => {
    const a = present(front[field]);
    const b = present(back[field]);
    if (a !== b) diffs.push(`dataPlane.${field} frontend=${String(a)} backend=${String(b)}`);
  };
  check('delivery');
  check('pushRequest');
  check('fetchOp');
  check('defaultIntervalMs');
  check('defaultMaxItems');
  return diffs;
}

function compareBinding(front: PanelBinding, back: PanelBinding): string | null {
  if (front.kind !== back.kind) {
    return `binding.kind frontend=${front.kind} backend=${back.kind}`;
  }
  // edgeBound 的具体句柄由后端从宿主控件端口表投影
  // (`app::models::catalog::resolve_binding`), 前端不复制端口表 → 只比对种类。
  if (front.kind === 'configBound' && back.kind === 'configBound') {
    if (front.configKey !== back.configKey || front.portTemplate !== back.portTemplate) {
      return `binding frontend=${front.configKey}|${front.portTemplate} backend=${back.configKey}|${back.portTemplate}`;
    }
  }
  if (
    front.kind === 'nodeScoped' &&
    back.kind === 'nodeScoped' &&
    front.nodeIdParam !== back.nodeIdParam
  ) {
    return `binding.nodeIdParam frontend=${front.nodeIdParam} backend=${back.nodeIdParam}`;
  }
  return null;
}

/// 比对同一面板的双侧声明; 一致返回 null, 否则返回逐字段分歧。
function comparePanel(def: PanelDef, descriptor: PanelDescriptor): string | null {
  const diffs: string[] = [];
  if (def.tabType !== descriptor.tabType) {
    diffs.push(`tabType frontend=${def.tabType} backend=${descriptor.tabType}`);
  }
  const backendHost = descriptor.hostWidgetKind ?? null;
  if (def.hostWidgetKind !== backendHost) {
    diffs.push(
      `hostWidgetKind frontend=${def.hostWidgetKind ?? 'null'} backend=${backendHost ?? 'null'}`
    );
  }
  const backendLabel = descriptor.display.labelKey ?? null;
  if (def.labelKey !== backendLabel) {
    diffs.push(`labelKey frontend=${def.labelKey} backend=${backendLabel ?? 'null'}`);
  }
  diffs.push(...compareDataPlane(def.dataPlane, descriptor.dataPlane));
  const bindingDiff = compareBinding(def.binding, descriptor.binding);
  if (bindingDiff !== null) diffs.push(bindingDiff);
  return diffs.length > 0 ? diffs.join('; ') : null;
}

/// 后端面板目录 → 与前端注册表比对后的完整结果 (含仅前端存在的条目)。
///
/// `descriptors` 为 undefined 表示目录未加载, 此时返回空数组: 不做比对也不报漂移。
export function reconcilePanels(
  descriptors: readonly PanelDescriptor[] | undefined
): ReconciledPanel[] {
  if (descriptors === undefined) return [];

  const reconciled: ReconciledPanel[] = [];
  const seen = new Set<string>();

  for (const descriptor of descriptors) {
    seen.add(descriptor.kind);
    const def = panelDefForKind(descriptor.kind);
    if (!def) {
      reconciled.push({
        panelKind: descriptor.kind,
        tabType: descriptor.tabType,
        labelKey: descriptor.display.labelKey ?? null,
        status: 'backend-only',
        descriptor,
        def: null,
        reason: `后端声明了前端未实现的面板 ${descriptor.kind}`,
      });
      continue;
    }
    const reason = comparePanel(def, descriptor);
    reconciled.push({
      panelKind: descriptor.kind,
      tabType: def.tabType,
      labelKey: def.labelKey,
      status: reason === null ? 'ok' : 'mismatch',
      descriptor,
      def,
      reason,
    });
  }

  for (const def of PANEL_DEFS_ORDERED) {
    if (seen.has(def.panelKind)) continue;
    reconciled.push({
      panelKind: def.panelKind,
      tabType: def.tabType,
      labelKey: def.labelKey,
      status: 'frontend-only',
      descriptor: null,
      def,
      reason: `前端注册表声明了后端未下发的面板 ${def.panelKind}`,
    });
  }

  return reconciled;
}

/// 需要 UI 占位的面板 (后端有前端无 / 契约漂移) —— 面板列表据此追加 unsupported 行。
export function unsupportedPanels(reconciled: readonly ReconciledPanel[]): ReconciledPanel[] {
  return reconciled.filter((panel) => panel.status === 'backend-only' || panel.status === 'mismatch');
}

/// 契约问题描述 — 供开发期日志 (不静默吞).
export function panelContractIssues(reconciled: readonly ReconciledPanel[]): string[] {
  return reconciled
    .filter((panel) => panel.status !== 'ok')
    .map((panel) => `panel contract: ${panel.reason ?? panel.panelKind}`);
}

/// 后端面板目录 → 与前端注册表比对后的结果 (目录未就绪时返回空数组)。
export function useReconciledPanels(): ReconciledPanel[] {
  const panels = useModelCatalogStore((s) => s.panels);
  const ready = useModelCatalogStore((s) => s.status === 'ready');
  return useMemo(() => reconcilePanels(ready ? panels : undefined), [ready, panels]);
}
