//! 设置项元数据定义 — 控制类型、字段接口、所有设置项列表
//!
//! 从 SettingsModal.tsx 提取，用于保持文件体积可控

import type { AppSettings } from '../settings/defaults';
import type { ModelDescriptor } from '../types/generated/ModelDescriptor';

export type ControlType =
  | { kind: 'select'; options: { value: string | number; label: string }[] }
  | { kind: 'toggle' }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'slider'; min: number; max: number; step: number; unit?: 'percent' }
  | { kind: 'text' }
  | { kind: 'path' }
  | { kind: 'theme' }
  | { kind: 'openSettingsFolder' };

export interface SettingFieldDef {
  category: keyof AppSettings;
  field: string;
  labelKey: string;
  descKey: string;
  control: ControlType;
  /// 用于搜索的关键词 (除了 label/desc)
  keywords?: string[];
}

/// 所有设置项的元数据 — 按分类顺序渲染
/// AI provider 选项 — 目录 aiProvider 家族是唯一权威 (后端 llm::types::ADAPTERS
/// 投影); 不再维护前端硬编码名单。
function aiAdapterField(models: readonly ModelDescriptor[]): SettingFieldDef {
  const options = models
    .filter((model) => model.family === 'aiProvider' && (model.actions ?? []).includes('configure'))
    .map((model) => ({
      value: model.id.startsWith('aiProvider:') ? model.id.slice('aiProvider:'.length) : model.id,
      label: model.display.fallbackLabel,
    }));
  return {
    category: 'ai',
    field: 'adapter',
    labelKey: 'settingAiAdapter',
    descKey: 'settingAiAdapterDesc',
    control: { kind: 'select', options },
    keywords: ['ai', 'llm', 'provider', '模型', '对话'],
  };
}

export function buildSettingFields(models: readonly ModelDescriptor[]): SettingFieldDef[] {
  return SETTING_FIELDS.map((field) => (field.field === 'adapter' ? aiAdapterField(models) : field));
}

import { generalFields } from './settingFieldGroups/generalFields';
import { appearanceFields } from './settingFieldGroups/appearanceFields';
import { editorFields } from './settingFieldGroups/editorFields';
import { dataFields } from './settingFieldGroups/dataFields';
import { serialFields } from './settingFieldGroups/serialFields';
import { notificationsFields } from './settingFieldGroups/notificationsFields';
import { performanceFields } from './settingFieldGroups/performanceFields';
import { aiFields } from './settingFieldGroups/aiFields';

const SETTING_FIELDS: SettingFieldDef[] = [
  ...generalFields,
  ...appearanceFields,
  ...editorFields,
  ...dataFields,
  ...serialFields,
  ...notificationsFields,
  ...performanceFields,
  ...aiFields,
];
