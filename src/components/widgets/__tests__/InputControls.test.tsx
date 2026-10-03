import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import { useAppStore } from '../../../store/appStore';
import { selectWidgets } from '../../../store/appStoreHelpers';
import { widgetInputValue } from '../../../lib/utils/widgetValue';
import { widgetFixture } from '../../../test/widgetFixtures';
import { Knob } from '../knob/KnobWidget';
import { Slider } from '../slider/SliderWidget';
import { Radio } from '../radio/RadioWidget';
import { Checkbox } from '../checkbox/CheckboxWidget';
import { NumericValueInput } from '../shared/NumericValueInput';
import { sendBindingValue } from '../shared/binding';


beforeEach(() => {
  useAppStore.setState({ rfNodes: [], rfEdges: [], inputPreviewValues: {} });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
});


/// 控件配置以画布节点 data.widget 为权威 — 测试种子用节点承载配置
const widgetNodeOf = (widget: { kind: string; params: { id: string } }) => ({
  id: widget.params.id,
  type: 'widget' as const,
  position: { x: 0, y: 0 },
  data: { widget },
});

describe('numeric input controls', () => {
  it('previews slider changes without persisting, then commits on release', () => {
    const widget = widgetFixture('Slider');
    if (widget.kind !== 'Slider') throw new Error('expected Slider');
    useAppStore.setState({ rfNodes: [widgetNodeOf(widget)] });
    renderWithI18n(<Slider widget={widget} />);

    const range = screen.getByRole('slider');
    expect(range).toHaveClass('nodrag', 'nowheel');
    fireEvent.change(range, { target: { value: '75' } });
    expect(useAppStore.getState().inputPreviewValues[widget.params.id]).toBe(75);
    expect((selectWidgets(useAppStore.getState())[0] as typeof widget).params.value).toBe(50);

    fireEvent.pointerUp(range);
    expect(useAppStore.getState().inputPreviewValues[widget.params.id]).toBeUndefined();
    expect((selectWidgets(useAppStore.getState())[0] as typeof widget).params.value).toBe(75);
  });

  it('supports relative pointer dragging on the knob', () => {
    const widget = widgetFixture('Knob');
    if (widget.kind !== 'Knob') throw new Error('expected Knob');
    useAppStore.setState({ rfNodes: [widgetNodeOf(widget)] });
    renderWithI18n(<Knob widget={widget} />);
    const knob = screen.getByRole('slider');

    fireEvent.pointerDown(knob, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 40 });
    const preview = useAppStore.getState().inputPreviewValues[widget.params.id];
    expect(preview).toBeGreaterThan(50);
    fireEvent.pointerUp(knob, { pointerId: 1, clientY: 40 });
    expect((selectWidgets(useAppStore.getState())[0] as typeof widget).params.value).toBe(preview);
  });

  it('commits manual input once on Enter and keeps invalid drafts visible', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    const view = renderWithI18n(<NumericValueInput value={50} min={0} max={100} step={1} onPreview={onPreview} onCommit={onCommit} />);
    const input = screen.getByRole('spinbutton');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '73' } });
    expect(onPreview).toHaveBeenLastCalledWith(73);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(73);

    view.rerender(<NumericValueInput value={73} min={0} max={100} step={1} onPreview={onPreview} onCommit={onCommit} />);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('rotates during number-stepper changes and commits once on release', () => {
    const widget = widgetFixture('Knob');
    if (widget.kind !== 'Knob') throw new Error('expected Knob');
    useAppStore.setState({ rfNodes: [widgetNodeOf(widget)] });
    renderWithI18n(<Knob widget={widget} />);
    const knob = screen.getByRole('slider');
    const input = screen.getByRole('spinbutton');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '51' } });
    expect(knob).toHaveAttribute('aria-valuenow', '51');
    expect(useAppStore.getState().inputPreviewValues[widget.params.id]).toBe(51);
    expect((selectWidgets(useAppStore.getState())[0] as typeof widget).params.value).toBe(50);

    fireEvent.pointerUp(input);
    expect(useAppStore.getState().inputPreviewValues[widget.params.id]).toBeUndefined();
    expect((selectWidgets(useAppStore.getState())[0] as typeof widget).params.value).toBe(51);
  });
});

describe('choice input controls', () => {
  it('persists radio selection by stable option id', () => {
    const widget = widgetFixture('Radio');
    if (widget.kind !== 'Radio') throw new Error('expected Radio');
    useAppStore.setState({ rfNodes: [widgetNodeOf(widget)] });
    renderWithI18n(<Radio widget={widget} />);
    fireEvent.click(screen.getByLabelText('B'));
    const stored = selectWidgets(useAppStore.getState())[0];
    expect(stored.kind).toBe('Radio');
    if (stored.kind !== 'Radio') return;
    expect(stored.params.selectedId).toBe(widget.params.options[1].id);
    expect(widgetInputValue(stored)).toBe(1);
  });

  it('renders a true multi-select and sums selected values', () => {
    const widget = widgetFixture('Checkbox');
    if (widget.kind !== 'Checkbox') throw new Error('expected Checkbox');
    useAppStore.setState({ rfNodes: [widgetNodeOf(widget)] });
    const view = renderWithI18n(<Checkbox widget={widget} />);
    fireEvent.click(screen.getByLabelText('A'));
    view.rerender(<Checkbox widget={selectWidgets(useAppStore.getState())[0] as typeof widget} />);
    fireEvent.click(screen.getByLabelText('B'));
    const stored = selectWidgets(useAppStore.getState())[0];
    expect(stored.kind).toBe('Checkbox');
    if (stored.kind !== 'Checkbox') return;
    expect(stored.params.selectedIds).toEqual(widget.params.options.map((option) => option.id));
    expect(widgetInputValue(stored)).toBe(3);
  });
});

describe('explicit bindings', () => {
  it('sends Auto values only through an existing connected compatible target', () => {
    const sendWidgetValue = vi.fn(() => Promise.resolve());
    useAppStore.setState({
      // 统一发送门控: 控件值发送要求工作区运行中
      runState: 'running',
      rfNodes: [
        { id: 'transport-1', type: 'acquisition', position: { x: 0, y: 0 }, data: {} },
        { id: 'protocol-1', type: 'protocol', position: { x: 0, y: 0 }, data: { config: { kind: 'JustFloat' } } },
      ],
      rfEdges: [],
      sendWidgetValue,
    });
    const binding = { mode: 'Auto', params: { transportId: 'transport-1', protocolId: 'protocol-1', channel: 2 } } as const;

    sendBindingValue(binding, 12);
    expect(sendWidgetValue).not.toHaveBeenCalled();

    useAppStore.setState({ rfEdges: [{ id: 'edge-1', source: 'transport-1', target: 'protocol-1' }] });
    sendBindingValue(binding, 12);
    expect(sendWidgetValue).toHaveBeenCalledOnce();
    expect(sendWidgetValue).toHaveBeenCalledWith('transport-1', 'protocol-1', binding, 12);
  });

  it('skips sends while the workspace is not running (unified send gating)', () => {
    const sendWidgetValue = vi.fn(() => Promise.resolve());
    const sendText = vi.fn(() => Promise.resolve());
    useAppStore.setState({
      runState: 'paused',
      rfNodes: [
        { id: 'transport-1', type: 'acquisition', position: { x: 0, y: 0 }, data: {} },
        { id: 'protocol-1', type: 'protocol', position: { x: 0, y: 0 }, data: { config: { kind: 'JustFloat' } } },
      ],
      rfEdges: [{ id: 'edge-1', source: 'transport-1', target: 'protocol-1' }],
      sendWidgetValue,
      sendText,
    });
    const binding = { mode: 'Auto', params: { transportId: 'transport-1', protocolId: 'protocol-1', channel: 2 } } as const;

    sendBindingValue(binding, 12);
    expect(sendWidgetValue).not.toHaveBeenCalled();

    // 恢复运行态后同一调用正常发出
    useAppStore.setState({ runState: 'running' });
    sendBindingValue(binding, 12);
    expect(sendWidgetValue).toHaveBeenCalledOnce();
  });

  it('does not send an incomplete Manual template', () => {
    const sendText = vi.fn(() => Promise.resolve());
    useAppStore.setState({
      rfNodes: [{ id: 'transport-1', type: 'acquisition', position: { x: 0, y: 0 }, data: {} }],
      sendText,
    });
    sendBindingValue({ mode: 'Manual', params: { transportId: 'transport-1', template: '   ' } }, 4);
    expect(sendText).not.toHaveBeenCalled();
  });
});
