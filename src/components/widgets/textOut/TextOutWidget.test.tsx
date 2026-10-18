import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Handle: ({ id }: { id?: string }) => <span data-handle-id={id} />,
    useUpdateNodeInternals: () => vi.fn(),
  };
});

import { renderWithI18n } from '../../../test/renderWithI18n';
import { widgetFixture } from '../../../test/widgetFixtures';
import { useAppStore } from '../../../store/appStore';
import { api } from '../../../lib/tauri/tauri';
import { WidgetNode } from '../../nodes/WidgetNode';
import { TextOutWidget } from './TextOutWidget';

/// 「立即发送」命令由宿主注入 — 内容组件只调用回调, 不持有后端命令。
describe('TextOutWidget host command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({ rfNodes: [], rfEdges: [], customTextOutputs: {} });
  });

  it('sends through the injected onSendNow callback', () => {
    const widget = widgetFixture('TextOut', { targetTransport: 'transport-1' });
    if (widget.kind !== 'TextOut') throw new Error('expected TextOut');
    const onSendNow = vi.fn();

    renderWithI18n(<TextOutWidget widget={widget} onSendNow={onSendNow} />);
    fireEvent.click(screen.getByRole('button'));

    expect(onSendNow).toHaveBeenCalledWith(widget.params.id);
  });

  it('reaches the backend command when rendered by its host (WidgetNode)', () => {
    const widget = widgetFixture('TextOut', { targetTransport: 'transport-1' });
    if (widget.kind !== 'TextOut') throw new Error('expected TextOut');
    const data = { widget, tabId: 'default' };
    useAppStore.setState({
      rfNodes: [{ id: widget.params.id, type: 'widget', position: { x: 0, y: 0 }, data }],
    });
    const send = vi.spyOn(api, 'sendTextOutNow').mockResolvedValue(undefined);

    renderWithI18n(
      <WidgetNode {...({ id: widget.params.id, data } as unknown as NodeProps)} />
    );
    fireEvent.click(screen.getByTitle(/立即发送|Send now/));

    expect(send).toHaveBeenCalledWith(widget.params.id);
  });
});
