import type { JsonSchema } from '../../types';
import type { JsonValue } from '../../types/generated/serde_json/JsonValue';

/// 把 wire 上的 jsonSchema (JsonValue) 收窄为表单引擎支持的 schema 子集。
/// 不是该子集 (或非对象) 时返回 null — 调用方必须显式处理, 不能假装校验成功。
export function asFormSchema(value: JsonValue): JsonSchema | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function defaultsFromSchema(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.type === 'object') {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, child]) => [name, defaultsFromSchema(child)]),
    );
  }
  if (schema.type === 'array') return [];
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 0;
  return '';
}

/// Apply an adapter discovery patch without knowing its field names. Object
/// branches merge recursively so a patch can fill one nested connection field
/// without discarding schema defaults or edits in sibling fields.
export function mergeSchemaPatch(current: unknown, patch: unknown): unknown {
  if (isObject(current) && isObject(patch)) {
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = key in merged ? mergeSchemaPatch(merged[key], value) : structuredClone(value);
    }
    return merged;
  }
  return structuredClone(patch);
}

export function validateSchemaValue(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.type === 'object') {
    if (!isObject(value)) return [`${path}: expected object`];
    for (const required of schema.required ?? []) {
      if (!(required in value) || value[required] === '') errors.push(`${path}.${required}: required`);
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (name in value) errors.push(...validateSchemaValue(child, value[name], `${path}.${name}`));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.items) value.forEach((item, index) => {
      errors.push(...validateSchemaValue(schema.items!, item, `${path}[${index}]`));
    });
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: expected string`);
    else if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: too short`);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected number`);
    else {
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
      if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum`);
      if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum`);
    }
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path}: expected boolean`);
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path}: unsupported value`);
  }
  return errors;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
