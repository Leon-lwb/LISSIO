import type { Dispatch, SetStateAction } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { useExitSnapshot } from '../../../lib/motion';
import type { GraphHir } from '../../../store/slices/compileHir';
import { DialogFooter, DialogHeader, DialogOverlay, DialogSurface } from '../../ui/Dialog';
import { FormField } from '../../ui/Form';
import { EMPTY_MODAL, type EdgeModalState } from './compileResultsModel';

interface EdgeEditDialogProps {
  modal: EdgeModalState;
  setModal: Dispatch<SetStateAction<EdgeModalState>>;
  hir: GraphHir | null;
  getNodeName: (id: string) => string;
  closeModal: () => void;
  submitModal: () => Promise<void>;
}

export function EdgeEditDialog({
  modal,
  setModal,
  hir,
  getNodeName,
  closeModal,
  submitModal,
}: EdgeEditDialogProps) {
  const lang = useAppStore((s) => s.lang);
  // 关闭时调用方会把整份状态重置成 EMPTY_MODAL (输入框清空)。保活期间节点还在,
  // 直接读就会看到表单在滑出的同时变白, 所以退场沿用最后一份有内容的表单。
  const shown = useExitSnapshot(modal.open ? modal : null) ?? EMPTY_MODAL;

  return (
    <DialogOverlay open={modal.open} onDismiss={closeModal}>
      <DialogSurface className="w-[420px] p-4" titleId="edge-edit-dialog-title">
        <DialogHeader className="justify-between border-0 p-0 mb-3">
          <h3 id="edge-edit-dialog-title" className="text-sm font-semibold text-text-primary">
            {shown.mode === 'add' ? translate('modalAddEdge', lang) : translate('modalModifyEdge', lang)}
          </h3>
          <button className="p-1 text-text-muted hover:text-text-primary" onClick={closeModal}>
            <X size={14} />
          </button>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-xs">
          <FormField label={translate('fieldSourceNode', lang)}>
            <select
              className="form-select"
              value={shown.sourceNode}
              onChange={(e) => setModal((m) => ({ ...m, sourceNode: e.target.value }))}
            >
              {(hir?.nodes ?? []).map((node) => (
                <option key={node.nodeId} value={node.nodeId}>{getNodeName(node.nodeId)}</option>
              ))}
            </select>
          </FormField>
          <FormField label={translate('fieldSourceHandle', lang)}>
            <input
              type="text"
              className="form-input font-mono"
              value={shown.sourceHandle}
              onChange={(e) => setModal((m) => ({ ...m, sourceHandle: e.target.value }))}
              placeholder="value / result / ch0..."
            />
          </FormField>
          <FormField label={translate('fieldTargetNode', lang)}>
            <select
              className="form-select"
              value={shown.targetNode}
              onChange={(e) => setModal((m) => ({ ...m, targetNode: e.target.value }))}
            >
              {(hir?.nodes ?? []).map((node) => (
                <option key={node.nodeId} value={node.nodeId}>{getNodeName(node.nodeId)}</option>
              ))}
            </select>
          </FormField>
          <FormField label={translate('fieldTargetHandle', lang)}>
            <input
              type="text"
              className="form-input font-mono"
              value={shown.targetHandle}
              onChange={(e) => setModal((m) => ({ ...m, targetHandle: e.target.value }))}
              placeholder="in0 / in1 / str..."
            />
          </FormField>
        </div>
        <DialogFooter className="justify-end border-0 p-0 mt-4">
          <button className="dialog-button dialog-button--ghost" onClick={closeModal}>
            {translate('cancel', lang)}
          </button>
          <button
            className="dialog-button dialog-button--primary disabled:opacity-disabled"
            onClick={() => void submitModal()}
            disabled={!shown.sourceNode || !shown.targetNode || shown.sourceNode === shown.targetNode}
          >
            {translate('confirmAdd', lang)}
          </button>
        </DialogFooter>
      </DialogSurface>
    </DialogOverlay>
  );
}
