import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Handle, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react';
import { X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { translate } from '../../i18n';
import { CanvasErrorTooltip } from '../ui/CanvasErrorTooltip';
import { useCanvasNodeError } from '../../lib/hooks/useCanvasNodeError';
import { domainColor } from '../widgets/shared/portVisuals';

export interface CanvasPort { id: string; label?: string; domain: string }
export interface NodeFrameProps {
  id: string;
  tabId: string;
  label: string;
  selected?: boolean;
  color: string;
  inputs: readonly CanvasPort[];
  outputs: readonly CanvasPort[];
  minWidth?: number;
  minHeight?: number;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onRename: (label: string) => void;
  onRemove: () => void;
  onOpen?: () => void;
}

/** Shared canvas chrome; renderers supply business content and ports. */
export function NodeFrame({ id, tabId, label, selected, color, inputs, outputs,
  minWidth = 140, minHeight = 80, status, actions, children, onRename, onRemove, onOpen,
}: NodeFrameProps) {
  const lang = useAppStore((s) => s.lang);
  const edges = useAppStore((s) => s.rfEdges);
  const highlighted = useAppStore((s) => s.canvasHighlight?.nodeId === id);
  const error = useCanvasNodeError(id, tabId);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const updateInternals = useUpdateNodeInternals();
  const signature = JSON.stringify([inputs, outputs]);
  useEffect(() => { updateInternals(id); }, [id, signature, updateInternals]);
  useEffect(() => { if (renaming) { input.current?.focus(); input.current?.select(); } }, [renaming]);
  const commit = () => {
    const next = draft.trim();
    if (!next) { setInvalid(true); return; }
    if (next !== label) onRename(next);
    setRenaming(false);
  };
  const portColumn = (ports: readonly CanvasPort[], output: boolean) => (
    <div className={`flex flex-col justify-center gap-0.5 py-1 z-10 ${output ? 'items-end -mr-1.5' : '-ml-1.5'}`}>
      {ports.map((port) => {
        const connected = edges.some((edge) => output
          ? edge.source === id && edge.sourceHandle === port.id
          : edge.target === id && (edge.targetHandle === port.id || port.id === `src:${edge.source}:${edge.sourceHandle}`));
        const portColor = port.domain === 'points' ? '#89d185' : domainColor(port.domain as Parameters<typeof domainColor>[0]);
        return <div key={port.id} className={`flex items-center gap-1 h-[14px] relative ${output ? 'flex-row-reverse' : ''}`} title={`${port.label ?? port.id} · ${port.domain}`}>
          <Handle type={output ? 'source' : 'target'} position={output ? Position.Right : Position.Left} id={port.id}
            style={{ position: 'relative', left: 'auto', right: 'auto', top: 'auto', transform: 'none', borderColor: portColor }}
            className={`w-[9px] h-[9px] bg-bg-input border-[1.5px] rounded-full cursor-crosshair motion-transition hover:bg-accent [&.valid]:border-green${connected ? ' connected' : ''}`} />
          <span className="text-[9px] text-text-secondary font-mono whitespace-nowrap bg-bg-sidebar px-0.5 rounded-sm">{port.label ?? port.id}</span>
          <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ backgroundColor: portColor }} />
        </div>;
      })}
    </div>
  );
  return <CanvasErrorTooltip message={error}>
    <div data-node-id={id} className="nowheel widget-card-acrylic rounded-md w-full h-full text-[11px] relative flex flex-col"
      style={{ minWidth, minHeight, boxShadow: error ? '0 0 0 2px #ef4444' : highlighted ? '0 0 0 2px var(--color-accent)' : undefined }}
      onDoubleClick={onOpen} title={onOpen ? translate('nodeOpenWindowHint', lang) : undefined}>
      <div className="contents" onDoubleClick={(event) => event.stopPropagation()}>
        <NodeResizer isVisible={!!selected} minWidth={minWidth} minHeight={minHeight} maxWidth={1600} maxHeight={1200}
          lineClassName="!border-accent" handleClassName="!w-[7px] !h-[7px] !border-accent !bg-bg-sidebar" />
      </div>
      <div className="node-drag-handle flex items-center gap-1 justify-between px-1.5 py-1 border-b border-border text-[10px] font-semibold cursor-grab active:cursor-grabbing"
        style={{ color }} title={translate('nodeRenameHint', lang)}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setDraft(label); setInvalid(false); setRenaming(true); }}>
        {renaming ? <input ref={input} className={`nodrag nowheel flex-1 min-w-0 h-5 px-1 rounded bg-bg-input text-text-primary outline-none border ${invalid ? 'border-red' : 'border-accent'}`}
          value={draft} aria-label={translate('widgetName', lang)} aria-invalid={invalid}
          onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
          onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
          onBlur={commit} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') commit(); if (event.key === 'Escape') setRenaming(false); }} />
          : <span className="flex-1 min-w-0 truncate" title={label}>{label}</span>}
        {status}{actions}
        <button type="button" aria-label={translate('removeWidget', lang)} className="nodrag w-4 h-4 opacity-muted hover:opacity-100 flex items-center justify-center rounded hover:bg-bg-hover"
          onClick={(event) => { event.stopPropagation(); onRemove(); }}><X size={10} /></button>
      </div>
      <div className="flex w-full flex-1 min-h-0">
        {portColumn(inputs, false)}
        <div className="flex-1 min-w-0 p-2 flex flex-col justify-center gap-1.5">{children}</div>
        {portColumn(outputs, true)}
      </div>
    </div>
  </CanvasErrorTooltip>;
}
