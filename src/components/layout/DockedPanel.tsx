import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Panel, type ImperativePanelHandle } from 'react-resizable-panels';
import { MotionPresence, dockPanelGeometry, type DockEdge } from '../../lib/motion';

export interface DockedPanelProps {
  /** Stable id: the layout store is keyed by it, so sizes survive a dock change. */
  id: string;
  /** Sort key inside the panel group. */
  order: number;
  /** Window edge this panel is docked to — its entrance anchor. */
  edge: DockEdge;
  /** Whether the drawer is open. Closing retracts it toward `edge`. */
  visible: boolean;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  /** Classes for the card surface inside the panel. */
  className?: string;
  children: ReactNode;
}

/**
 * A drawer docked to a window edge.
 *
 * The panel's *width* is the spatial half of the motion: collapsing it to zero
 * makes the card compress toward the dock edge, because in a flex row the outer
 * edge stays put and the inner one travels. `docked-panel.css` transitions that
 * width with the same spring tokens everything else uses.
 *
 * `MotionPresence` owns the other half — opacity, the entrance offset, and the
 * retention that lets the exit finish before the card is torn down. CSS keyframes
 * could not do that part: they cannot stop React from unmounting the node, which
 * is exactly why a docked panel used to vanish instantly on close.
 *
 * The panel stays mounted while closed, so the two halves can overlap. Its width
 * is already zero, so it costs no space and no handle is rendered.
 */
export function DockedPanel({
  id,
  order,
  edge,
  visible,
  defaultSize,
  minSize,
  maxSize,
  className = '',
  children,
}: DockedPanelProps) {
  const panelRef = useRef<ImperativePanelHandle>(null);
  const geometry = dockPanelGeometry(edge);
  const [settled, setSettled] = useState(false);

  // A panel group resolves its layout in its *own* layout effect, which runs after
  // this component's. So on the mount commit the panel is registered but has no
  // size yet, and driving it would assert. Waiting one commit lets the group lay
  // out first; the panel is already in the tree by then, so there is no visible gap.
  useLayoutEffect(() => {
    setSettled(true);
  }, []);

  // Runs in the same layout pass that flips `visible`, so the width starts
  // collapsing before the browser paints and stays in step with the fade.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!settled || !panel) return;
    if (visible) panel.expand();
    else panel.collapse();
  }, [visible, settled]);

  return (
    <Panel
      ref={panelRef}
      id={id}
      order={order}
      defaultSize={defaultSize}
      minSize={minSize}
      maxSize={maxSize}
      collapsible
      collapsedSize={0}
      className="dock-panel"
      data-flip-key={id}
      data-dock-edge={edge}
      data-dock-state={visible ? 'open' : 'closed'}
    >
      <MotionPresence
        visible={visible}
        variant="panel"
        className={`h-full w-full ${className}`}
        origin={geometry.origin}
        travel={geometry.enterFrom}
        scale={geometry.enterScale}
      >
        {children}
      </MotionPresence>
    </Panel>
  );
}
