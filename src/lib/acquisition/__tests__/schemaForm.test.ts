import { describe, expect, it } from 'vitest';
import { defaultsFromSchema, mergeSchemaPatch, validateSchemaValue } from '../schemaForm';
import type { JsonSchema } from '../../../types';

const schema: JsonSchema = {
  type: 'object',
  required: ['host', 'points'],
  properties: {
    host: { type: 'string', minLength: 1, default: '127.0.0.1' },
    port: { type: 'integer', minimum: 1, maximum: 65535, default: 502 },
    points: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
    },
  },
};

describe('generic capability schema form', () => {
  it('derives stable nested defaults', () => {
    expect(defaultsFromSchema(schema)).toEqual({ host: '127.0.0.1', port: 502, points: [] });
  });

  it('validates required, range, and nested array values', () => {
    expect(validateSchemaValue(schema, { host: '', port: 0, points: [{ id: '' }] })).toEqual([
      '$.host: required',
      '$.host: too short',
      '$.port: below minimum',
      '$.points[0].id: required',
      '$.points[0].id: too short',
    ]);
  });

  it('accepts a valid payload while preserving unknown driver fields', () => {
    expect(validateSchemaValue(schema, {
      host: 'plc.local',
      port: 502,
      points: [{ id: 'temperature', vendorExtension: true }],
      futureOption: 'preserved',
    })).toEqual([]);
  });

  it('applies arbitrary discovery patches without hard-coded adapter field names', () => {
    expect(mergeSchemaPatch(
      { connection: { host: 'manual', port: 502 }, points: [{ id: 'temperature' }] },
      { connection: { host: 'discovered' }, vendorExtension: { path: '/device/1' } },
    )).toEqual({
      connection: { host: 'discovered', port: 502 },
      points: [{ id: 'temperature' }],
      vendorExtension: { path: '/device/1' },
    });
  });
});
