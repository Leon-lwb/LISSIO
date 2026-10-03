import type { Dispatch, SetStateAction } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { t } from '../../../i18n';
import type { GraphHir } from '../../../store/slices/compileHir';
import { DialogFooter, DialogHeader, DialogOverlay, DialogSurface } from '../../ui/Dialog';
import { FormField } from '../../ui/Form';
import type { EdgeModalState } from './compileResultsModel';

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
  if (!modal.open) return null;

  return (
    <DialogOverlay>
      <DialogSurface className="w-[420px] p-4">
        <DialogHeader className="justify-between border-0 p-0 mb-3">
          <h3 className="text-sm font-semibold text-text-primary">
            {modal.mode === 'add' ? t(lang, 'modalAddEdge') : t(lang, 'modalModifyEdge')}
          </h3>
          <button className="p-1 text-text-muted hover:text-text-primary" onClick={closeModal}>
            <X size={14} />
          </button>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-xs">
          <FormField label={t(lang, 'fieldSourceNode')}>
            <select
              className="form-select"
              value={modal.sourceNode}
              onChange={(e) => setModal((m) => ({ ...m, sourceNode: e.target.value }))}
            >
              {(hir?.nodes ?? []).map((node) => (
                <option key={node.nodeId} value={node.nodeId}>{getNodeName(node.nodeId)}</option>
              ))}
            </select>
          </FormField>
          <FormField label={t(lang, 'fieldSourceHandle')}>
            <input
              type="text"
              className="form-input font-mono"
              value={modal.sourceHandle}
              onChange={(e) => setModal((m) => ({ ...m, sourceHandle: e.target.value }))}
              placeholder="value / result / ch0..."
            />
          </FormField>
          <FormField label={t(lang, 'fieldTargetNode')}>
            <select
              className="form-select"
              value={modal.targetNode}
              onChange={(e) => setModal((m) => ({ ...m, targetNode: e.target.value }))}
            >
              {(hir?.nodes ?? []).map((node) => (
                <option key={node.nodeId} value={node.nodeId}>{getNodeName(node.nodeId)}</option>
              ))}
            </select>
          </FormField>
          <FormField label={t(lang, 'fieldTargetHandle')}>
            <input
              type="text"
              className="form-input font-mono"
              value={modal.targetHandle}
              onChange={(e) => setModal((m) => ({ ...m, targetHandle: e.target.value }))}
              placeholder="in0 / in1 / str..."
            />
          </FormField>
        </div>
        <DialogFooter className="justify-end border-0 p-0 mt-4">
          <button className="dialog-button dialog-button--ghost" onClick={closeModal}>
            {t(lang, 'cancel')}
          </button>
          <button
            className="dialog-button dialog-button--primary disabled:opacity-disabled"
            onClick={() => void submitModal()}
            disabled={!modal.sourceNode || !modal.targetNode || modal.sourceNode === modal.targetNode}
          >
            {t(lang, 'confirmAdd')}
          </button>
        </DialogFooter>
      </DialogSurface>
    </DialogOverlay>
  );
}
