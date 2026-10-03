import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import type { JsonValue } from '../../../types/generated/serde_json/JsonValue';
import { SchemaFields } from '../SchemaFields';

/// 串口驱动的能力 schema (与 `device_factory::field_schema` 同形: 属性名 = 扁平负载键)
const SERIAL_SCHEMA = {
  type: 'object',
  properties: {
    port_name: { type: 'string', default: '' },
    baud_rate: { type: 'integer', default: 115200, minimum: 1 },
    data_bits: { type: 'integer', default: 8, enum: [5, 6, 7, 8] },
    parity: { type: 'string', default: 'none', enum: ['none', 'odd', 'even'] },
  },
  required: ['port_name', 'baud_rate', 'data_bits', 'parity'],
  additionalProperties: false,
} as unknown as JsonValue;

function renderFields(value: unknown, onChange: (next: unknown) => void = vi.fn()) {
  renderWithI18n(<SchemaFields schema={SERIAL_SCHEMA} value={value} onChange={onChange} />);
}

function selectFor(label: string): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>(label);
}

/// 配置缺字段 (或形状不符) 时浏览器会静默把选择器显示成第一个候选 —
/// 用户看到的值与真实配置不符, 且「选中当前显示值」不触发 change
/// (表现为「必须先选别的再选回来」)。这里断言显式未设置项。
describe('SchemaFields 枚举字段的未设置态', () => {
  it('值不在候选里时显示未设置, 而不是静默回落首选项', () => {
    renderFields({});
    const select = selectFor('数据位');
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]?.textContent).toBe('未设置');
    expect(within(select).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['未设置', '5', '6', '7', '8']);
  });

  it('选择第一个候选即触发一次变更 (不再被吞掉)', () => {
    const onChange = vi.fn();
    renderFields({}, onChange);
    fireEvent.change(selectFor('数据位'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ data_bits: 5 });
  });

  it('值命中候选时不渲染未设置项', () => {
    renderFields({ data_bits: 8, parity: 'even' });
    const dataBits = selectFor('数据位');
    expect(dataBits.value).toBe('8');
    expect(within(dataBits).getAllByRole('option')).toHaveLength(4);
    expect(selectFor('校验位').value).toBe('even');
  });

  it('校验位选择真实候选写回枚举原值', () => {
    const onChange = vi.fn();
    renderFields({ parity: 'none' }, onChange);
    fireEvent.change(selectFor('校验位'), { target: { value: 'odd' } });
    expect(onChange).toHaveBeenCalledWith({ parity: 'odd' });
  });
});

describe('SchemaFields 标量字段缺省提示', () => {
  it('数字字段缺值时为空输入并用 schema 默认值做占位', () => {
    renderFields({});
    const baudRate = screen.getByLabelText<HTMLInputElement>('波特率');
    expect(baudRate.value).toBe('');
    expect(baudRate.placeholder).toBe('115200');
  });

  it('数字字段有值时按值渲染', () => {
    renderFields({ baud_rate: 9600 });
    expect((screen.getByLabelText<HTMLInputElement>('波特率')).value).toBe('9600');
  });

  it('文本字段缺值时为空输入 (不静默写入默认值)', () => {
    renderFields({});
    const portName = screen.getByLabelText<HTMLInputElement>('串口');
    expect(portName.value).toBe('');
  });
});
