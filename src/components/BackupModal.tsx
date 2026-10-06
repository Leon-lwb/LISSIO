//! 拆分备份弹窗 — 按分区勾选导出 / 导入
//!
//! 分区: 节点图 / 窗口组织 / 设置 / 传输与协议 / 控件与标签页。
//! 导出: 仅写入所选分区; 导入: 选择文件后按所选分区恢复。

import { useEffect, useState } from 'react';
import { X, Download, Upload, CheckSquare, Square } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
import {
  ALL_BACKUP_SECTIONS,
  detectPresentSections,
  exportSectionsToFile,
  readSnapshotFromFile,
  applySnapshot,
  type AppSnapshot,
  type BackupSection,
} from '../lib/tauri/appExport';
import { DialogOverlay, DialogSurface } from './ui/Dialog';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SECTION_META: { id: BackupSection; labelKey: string; descKey: string }[] = [
  { id: 'workspace', labelKey: 'backupSectionWorkspace', descKey: 'backupSectionWorkspaceDesc' },
  { id: 'windowLayout', labelKey: 'backupSectionWindowLayout', descKey: 'backupSectionWindowLayoutDesc' },
  { id: 'settings', labelKey: 'backupSectionSettings', descKey: 'backupSectionSettingsDesc' },
];

export function BackupModal({ isOpen, onClose }: BackupModalProps) {
  const lang = useAppStore((s) => s.lang);
  const [selected, setSelected] = useState<Set<BackupSection>>(new Set(ALL_BACKUP_SECTIONS));
  // 已选择的导入文件 (读取后待确认)
  const [pendingSnapshot, setPendingSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set(ALL_BACKUP_SECTIONS));
    setPendingSnapshot(null);
  }, [isOpen]);

  const toggle = (s: BackupSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ALL_BACKUP_SECTIONS));
  const clearAll = () => setSelected(new Set());

  const selectedList = ALL_BACKUP_SECTIONS.filter((s) => selected.has(s));

  const handleExport = async () => {
    if (selectedList.length === 0) return;
    await exportSectionsToFile(selectedList);
  };

  const handlePickFile = async () => {
    const snap = await readSnapshotFromFile();
    if (!snap) return;
    setPendingSnapshot(snap);
    const present = detectPresentSections(snap);
    setSelected(new Set(present.length ? present : ALL_BACKUP_SECTIONS));
  };

  const handleConfirmImport = async () => {
    const snap = pendingSnapshot;
    setPendingSnapshot(null);
    if (!snap || selectedList.length === 0) return;
    await applySnapshot(snap, { sections: selectedList });
  };

  return (
    <DialogOverlay open={isOpen} onDismiss={onClose} zClassName="z-modal">
      <DialogSurface
        className="w-[460px] max-w-[92vw] max-h-[88vh]"
        label={translate('backupModalTitle', lang)}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border dialog-chrome flex-shrink-0">
          <span className="text-sm font-semibold text-text-bright">{translate('backupModalTitle', lang)}</span>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
            onClick={onClose}
            title={translate('settingsClose', lang)}
          >
            <X size={16} />
          </button>
        </div>

        {/* 分区勾选 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{translate('backupSelectHint', lang)}</span>
            <div className="flex gap-2">
              <button
                className="text-xs text-text-secondary hover:text-text-bright transition-colors cursor-pointer bg-transparent border-none"
                onClick={selectAll}
              >
                {translate('backupSelectAll', lang)}
              </button>
              <button
                className="text-xs text-text-secondary hover:text-text-bright transition-colors cursor-pointer bg-transparent border-none"
                onClick={clearAll}
              >
                {translate('backupSelectNone', lang)}
              </button>
            </div>
          </div>

          {SECTION_META.map((meta) => {
            const checked = selected.has(meta.id);
            return (
              <button
                type="button"
                key={meta.id}
                className="flex w-full items-start gap-2.5 p-2.5 bg-bg-input border border-border-subtle rounded-md cursor-pointer transition-colors hover:border-accent/50 text-left"
                onClick={() => toggle(meta.id)}
              >
                <span className="text-accent flex-shrink-0 mt-0.5">
                  {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-text-primary">{translate(meta.labelKey, lang)}</div>
                  <div className="text-[11px] text-text-secondary leading-snug mt-0.5">
                    {translate(meta.descKey, lang)}
                  </div>
                </div>
              </button>
            );
          })}

          {/* 导入确认区 */}
          {pendingSnapshot && (
            <div className="mt-1 p-3 bg-accent/10 border border-accent/40 rounded-md">
              <div className="text-xs text-text-primary mb-2">{translate('backupImportReady', lang)}</div>
              <button
                className="w-full px-3 h-8 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm transition-colors hover:bg-bg-button-hover inline-flex items-center justify-center gap-1.5"
                onClick={() => void handleConfirmImport()}
              >
                <Upload size={14} />
                <span>{translate('backupConfirmImport', lang)}</span>
              </button>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border dialog-chrome flex-shrink-0">
          <button
            className="flex-1 px-3 h-8 bg-bg-button text-text-inverse border-none rounded cursor-pointer text-sm transition-colors hover:bg-bg-button-hover inline-flex items-center justify-center gap-1.5 disabled:opacity-disabled disabled:cursor-default"
            onClick={() => void handleExport()}
            disabled={selectedList.length === 0}
          >
            <Download size={14} />
            <span>{translate('backupExportSelected', lang)}</span>
          </button>
          <button
            className="flex-1 px-3 h-8 bg-bg-input text-text-primary border border-border rounded cursor-pointer text-sm transition-colors hover:bg-bg-hover hover:border-accent inline-flex items-center justify-center gap-1.5"
            onClick={() => void handlePickFile()}
          >
            <Upload size={14} />
            <span>{translate('backupImportFromFile', lang)}</span>
          </button>
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}
