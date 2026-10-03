import type { JsonValue } from '../../types/generated/serde_json/JsonValue';
import { useAppStore } from '../../store/appStore';
import { translate } from '../../i18n';
import { DraftInput, DraftNumberInput } from '../ui/fields';
import { asFormSchema, defaultsFromSchema } from '../../lib/acquisition/schemaForm';
import { schemaEnumLabel, schemaFieldLabel } from './schemaLabels';

interface SchemaFieldsProps {
  /// wire 上的 jsonSchema (JsonValue); 内部收窄为表单支持的子集
  schema: JsonValue;
  value: unknown;
  onChange: (value: unknown) => void;
  path?: string;
  /// wire 上的 uiHints (JsonValue); 内部收窄为对象视图
  uiHints?: JsonValue;
  disabled?: boolean;
}

export function SchemaFields(props: SchemaFieldsProps) {
  const { value, onChange, path = '$', disabled = false } = props;
  const lang = useAppStore((state) => state.lang);
  const schema = asFormSchema(props.schema);
  const uiHints = asHints(props.uiHints);
  if (!schema) {
    // schema 不是本项目支持的表单子集 — 显式提示, 不假装校验成功
    return <p className="text-[11px] text-warning">{translate('schemaUnsupported', lang)}</p>;
  }
  if (schema.type === 'object') {
    const object = asObject(value);
    const entries = Object.entries(schema.properties ?? {}).sort(([left], [right]) => {
      const leftOrder = Number(uiHints?.[left]?.order ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = Number(uiHints?.[right]?.order ?? Number.MAX_SAFE_INTEGER);
      return leftOrder - rightOrder;
    });
    return (
      <div className="flex flex-col gap-2">
        {entries.map(([name, child]) => (
          <div key={`${path}.${name}`} className="block text-[11px] text-text-secondary">
            <label htmlFor={`${path}.${name}`} className="block mb-1 text-text-secondary">{child.title ?? schemaFieldLabel(lang, name) ?? formatLabel(name)}</label>
            <SchemaFields
              schema={child as JsonValue}
              value={object[name]}
              onChange={(next) => onChange({ ...object, [name]: next })}
              path={`${path}.${name}`}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    );
  }

  if (schema.type === 'array') {
    const items: unknown[] = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={`${path}.${index}`} className="rounded border border-border-subtle p-2">
            <SchemaFields
              schema={(schema.items ?? { type: 'string' }) as JsonValue}
              value={item}
              onChange={(next) => onChange(items.map((current, itemIndex) => itemIndex === index ? next : current))}
              path={`${path}[${index}]`}
              disabled={disabled}
            />
            <button
              type="button"
              className="mt-2 text-[10px] text-red hover:text-text-bright"
              disabled={disabled}
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            >
              {translate('removeWidget', lang)}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="h-7 rounded border border-dashed border-border text-[11px] text-text-secondary hover:border-accent/50"
          disabled={disabled}
          onClick={() => onChange([...items, defaultsFromSchema(schema.items ?? { type: 'string' })])}
        >
          + {translate('addConnection', lang)}
        </button>
      </div>
    );
  }

  if (schema.enum) {
    // 当前值不在候选里 (配置缺字段/形状不符) 时**显式**渲染未设置项:
    // 否则浏览器静默回落到第一个 option — 用户看到的值与真实配置不符,
    // 且「选中当前显示值」不触发 change (必须先选别的再选回来)。
    const current = optionText(value);
    const matched = schema.enum.some((candidate) => optionText(candidate) === current);
    return (
      <select
        id={path}
        className="form-select"
        disabled={disabled}
        value={matched ? current : ''}
        onChange={(event) => {
          const selected = schema.enum?.find((candidate) => optionText(candidate) === event.target.value);
          onChange(selected);
        }}
      >
        {!matched && (
          <option value="" disabled>{translate('schemaValueUnset', lang)}</option>
        )}
        {schema.enum.map((option) => {
          const raw = optionText(option);
          return <option key={raw} value={raw}>{schemaEnumLabel(lang, raw) ?? raw}</option>;
        })}
      </select>
    );
  }

  if (schema.type === 'boolean') {
    return (
      <input
        id={path}
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    return (
      <DraftNumberInput
        id={path}
        className="form-input"
        disabled={disabled}
        step={schema.type === 'integer' ? 1 : 'any'}
        integer={schema.type === 'integer'}
        min={schema.minimum}
        max={schema.maximum}
        value={typeof value === 'number' ? value : null}
        // 配置缺该字段时输入框为空 — 用 schema 默认值做占位提示, 不静默写入
        placeholder={scalarPlaceholder(schema.default)}
        onCommit={onChange}
      />
    );
  }

  return (
    <DraftInput
      id={path}
      type="text"
      className="form-input"
      disabled={disabled}
      value={typeof value === 'string' ? value : ''}
      placeholder={scalarPlaceholder(schema.default)}
      onCommit={onChange}
    />
  );
}

/// schema 默认值的占位提示 — 仅标量有意义 (对象/数组/空值返回 undefined)
function scalarPlaceholder(value: JsonValue | undefined): string | undefined {
  if (value == null || typeof value === 'object') return undefined;
  return String(value);
}

function asHints(value: JsonValue | undefined): Record<string, Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, Record<string, unknown>>;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatLabel(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function optionText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}
