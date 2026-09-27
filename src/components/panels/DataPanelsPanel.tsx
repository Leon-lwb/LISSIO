//! 数据面板面板 (Sidebar 'panels' view)
//!
//! 单一独立的 Sidebar 面板, 提供所有数据面板类型的一键打开入口。
//! 与顶层菜单 Panel / QuickStart / CategoryPanel 完全分离, 唯一的数据面板 UI 入口。
//!
//! 行为:
//! - 独立面板 (compile-errors / compile-results / can / logic) 总是 available,
//!   重复点击在同类型的多个 Tab 间轮转 (虽然通常只有一个, 但留接口给将来扩展)
//! - 派生面板 (waveform-extra / spectrum / ... 等) 按画布是否已有该类 widget 可用;
//!   点开时如果已有同类型 Tab 则轮转, 没有则用画布首个同类 widget 创建
//! - 点击后同步激活目标 Tab 所在的 Dock 卡片, 视觉上立即跳到该面板

import { AlertTriangle, Layers } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import {
  getAvailableDataPanelEntries,
  cycleDataPanelTab,
  type DataPanelEntry,
} from '../../store/slices/dataTabs';
import { panelIconForTabType } from './registry/panelDefs';
import { panelContractIssues, unsupportedPanels, useReconciledPanels } from './registry/reconcile';
import { openDataPanelAndReveal, openNodePropertiesPanel } from '../../lib/utils/revealDataTab';
import { t } from '../../i18n';
import { useEffect } from 'react';

export function DataPanelsPanel() {
  const lang = useAppStore((s) => s.lang);
  const dataTabs = useAppStore((s) => s.dataTabs);
  const rfNodes = useAppStore((s) => s.rfNodes);
  const addCompileErrorsTab = useAppStore((s) => s.addCompileErrorsTab);
  const addCompileResultsTab = useAppStore((s) => s.addCompileResultsTab);
  const addCanTab = useAppStore((s) => s.addCanTab);
  const addLogicTab = useAppStore((s) => s.addLogicTab);
  const addOperationHistoryTab = useAppStore((s) => s.addOperationHistoryTab);
  const addNodePropertiesTab = useAppStore((s) => s.addNodePropertiesTab);
  const addWidgetTab = useAppStore((s) => s.addWidgetTab);

  /// 后端目录 × 前端注册表 — 不一致的面板显式占位 + 开发期报错, 不静默
  const reconciled = useReconciledPanels();
  const unsupported = unsupportedPanels(reconciled);
  useEffect(() => {
    for (const issue of panelContractIssues(reconciled)) console.error(issue);
  }, [reconciled]);

  const panelEntries = getAvailableDataPanelEntries(
    { dataTabs, rfNodes, lang },
    {
      addCompileErrorsTab,
      addCompileResultsTab,
      addCanTab,
      addLogicTab,
      addOperationHistoryTab,
      addNodePropertiesTab,
      addDataTab: useAppStore.getState().addDataTab,
      setActiveDataTab: useAppStore.getState().setActiveDataTab,
      addWidgetTab,
    }
  );

  /// 派生面板分组 + 独立面板分组 — 视觉上独立的两块, 与菜单结构保持一致
  const standalone = panelEntries.filter((e) => e.group === 'standalone');
  const derived = panelEntries.filter((e) => e.group === 'derived');

  return (
    <div className="flex flex-col h-full overflow-hidden gap-3">
      <Section
        title={t(lang, 'dataPanelsStandaloneTitle')}
        entries={standalone}
        onClick={(entry) => {
          // 属性面板: 创建时同步在画布右侧拆分专属小卡 (非并入数据卡)
          if (entry.type === 'node-properties') {
            openNodePropertiesPanel();
            return;
          }
          // 已在该类型的 Tab 之间轮转 (通常只有一个, 但有兜底)
          openDataPanelAndReveal(() => cycleDataPanelTab(entry.type));
        }}
      />

      <Section
        title={t(lang, 'dataPanelsDerivedTitle')}
        entries={derived}
        onClick={(entry) => {
          // 派生面板: 已有同类 Tab 轮转 (多个 Waveform 时),
          // 没有时用首个同类 widget 创建
          openDataPanelAndReveal(() => {
            if (!entry.available) {
              // 灰显时强制调一次 open (addWidgetTab / addXTab 内部会判空, 不会重复创建)
              entry.open();
            } else {
              cycleDataPanelTab(entry.type);
            }
          });
        }}
      />

      <UnsupportedSection panels={unsupported} />
    </div>
  );
}

/// 后端声明但前端无法渲染的面板 — 显式占位, 不静默空白。
/// 契约一致时该段为空, 不产生任何 DOM。
function UnsupportedSection({ panels }: { panels: ReturnType<typeof unsupportedPanels> }) {
  const lang = useAppStore((s) => s.lang);
  if (panels.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-text-secondary px-1">
        {t(lang, 'dataPanelsUnsupportedTitle')}
      </div>
      <div className="flex flex-col gap-1">
        {panels.map((panel) => (
          <button
            key={panel.panelKind}
            disabled
            title={panel.reason ?? panel.panelKind}
            className="flex items-center gap-2 px-2 h-8 bg-bg-input border border-border-subtle rounded text-[12px] text-text-secondary opacity-40 cursor-not-allowed text-left"
          >
            <AlertTriangle size={14} />
            <span className="truncate">
              {panel.labelKey === null ? panel.panelKind : t(lang, panel.labelKey)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  entries: DataPanelEntry[];
  onClick: (entry: DataPanelEntry) => void;
}

function Section({ title, entries, onClick }: SectionProps) {
  const lang = useAppStore((s) => s.lang);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-text-secondary px-1">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((e) => {
          // 图标与 tab 条同源 (注册表); 未知类型回落通用图标
          const Icon = panelIconForTabType(e.type) ?? Layers;
          return (
            <button
              key={e.type}
              disabled={!e.available}
              onClick={() => onClick(e)}
              className="flex items-center gap-2 px-2 h-8 bg-bg-input border border-border-subtle rounded text-[12px] text-text-secondary transition-colors hover:text-text-bright hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed text-left"
              title={e.available ? t(lang, e.labelKey) : `${t(lang, e.labelKey)} (${t(lang, 'panelOpenNoWidget')})`}
            >
              <Icon size={14} />
              <span className="truncate">{t(lang, e.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
