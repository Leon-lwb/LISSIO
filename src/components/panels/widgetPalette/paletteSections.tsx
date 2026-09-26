import {
  Square,
  Plus,
  Minus,
  Divide,
  Sigma,
  ArrowDownToLine,
  ArrowUpToLine,
  ArrowRightLeft,
  Ban,
  Cable,
  Binary,
  Search,
  Ruler,
  TextSearch,
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Link2,
  TextCursorInput,
  Delete,
  Replace,
  CaseUpper,
  CaseLower,
  Eraser,
  ArrowLeftRight,
  Braces,
  ListOrdered,
  Send,
  Type,
  LineChart,
  Tag,
  Code,
  type LucideIcon,
} from 'lucide-react';
import type { PaletteCategoryId } from '../../../types';
import { t, type Lang } from '../../../i18n';
import { WIDGET_REGISTRY } from '../../widgets/registry';
import type { WidgetKind } from '../../widgets/registryTypes';
import type { DeviceCardModel } from '../../../lib/acquisition/deviceCardModel';
import type { ModelDescriptor } from '../../../types/generated/ModelDescriptor';
import type { ModelVariant } from '../../../types/generated/ModelVariant';
import type { PaletteEntry, PaletteSection } from './paletteModel';

export const PALETTE_CATEGORY_IDS: readonly PaletteCategoryId[] = [
  'transport', 'protocol', 'send', 'math', 'string', 'display', 'input', 'attributes', 'custom',
];

export function categoryLabel(lang: Lang, id: PaletteCategoryId): string {
  switch (id) {
    case 'transport': return t(lang, 'catConnections');
    case 'protocol': return t(lang, 'catCodecs');
    case 'send': return t(lang, 'catSending');
    case 'math': return t(lang, 'catSignalProcessing');
    case 'string': return t(lang, 'catTextProcessing');
    case 'display': return t(lang, 'catDisplay');
    case 'input': return t(lang, 'catInput');
    case 'attributes': return t(lang, 'catAttributes');
    case 'custom': return t(lang, 'catCustom');
  }
}

export const CATEGORY_ICONS: Record<PaletteCategoryId, LucideIcon> = {
  transport: Cable,
  protocol: Binary,
  send: Send,
  math: Sigma,
  string: Type,
  display: LineChart,
  input: TextCursorInput,
  attributes: Tag,
  custom: Code,
};

function entriesForKinds(lang: Lang, kinds: readonly WidgetKind[]): PaletteEntry[] {
  return kinds.map((kind) => {
    const def = WIDGET_REGISTRY[kind];
    return {
      key: kind,
      kind,
      modelId: `widget:${kind}`,
      icon: <def.icon size={14} />,
      label: t(lang, def.labelKey),
      title: t(lang, def.labelKey),
    };
  });
}

// ---- 目录变体条目 (Math/Str 运算、Filter 预设) ----
// 条目与变体清单来自模型目录 (后端注册表), 图标与文案映射是纯前端 UI —
// 未命中映射的变体用目录 fallbackLabel + 兜底图标照常展示 (新变体免改面板)。

const MATH_VARIANT_ICONS: Record<string, LucideIcon> = {
  add: Plus, sub: Minus, mul: Square, div: Divide, avg: Sigma, min: Sigma, max: Sigma,
  abs: Sigma, neg: Minus, square: Square, sqrt: Sigma, sin: Sigma, cos: Sigma, tan: Sigma, log: Sigma,
};
const MATH_VARIANT_LABEL_KEYS: Record<string, string> = {
  add: 'mathAdd', sub: 'mathSub', mul: 'mathMul', div: 'mathDiv', avg: 'mathAvg',
  min: 'mathMin', max: 'mathMax', abs: 'mathAbs', neg: 'mathNeg', square: 'mathSquare',
  sqrt: 'mathSqrt', sin: 'mathSin', cos: 'mathCos', tan: 'mathTan', log: 'mathLog',
};

const FILTER_VARIANT_ICONS: Record<string, LucideIcon> = {
  Lowpass: ArrowDownToLine, Highpass: ArrowUpToLine, Bandpass: ArrowRightLeft, Bandstop: Ban,
};
const FILTER_VARIANT_LABEL_KEYS: Record<string, string> = {
  Lowpass: 'filterLowpass', Highpass: 'filterHighpass', Bandpass: 'filterBandpass', Bandstop: 'filterBandstop',
};

const STR_VARIANT_ICONS: Record<string, LucideIcon> = {
  len: Ruler, find: TextSearch, contains: Search, left: ArrowLeftToLine, right: ArrowRightToLine,
  mid: Scissors, concat: Link2, insert: TextCursorInput, delete: Delete, replace: Replace,
  upper: CaseUpper, lower: CaseLower, trim: Eraser, reverse: ArrowLeftRight, format: Braces,
  parse: ListOrdered, encode_hex: Binary,
};
const STR_VARIANT_LABEL_KEYS: Record<string, string> = {
  len: 'strLen', find: 'strFind', contains: 'strContains', left: 'strLeft', right: 'strRight',
  mid: 'strMid', concat: 'strConcat', insert: 'strInsert', delete: 'strDelete', replace: 'strReplace',
  upper: 'strUpper', lower: 'strLower', trim: 'strTrim', reverse: 'strReverse', format: 'strFormat',
  parse: 'strParse', encode_hex: 'strEncodeHex',
};
const STR_VARIANT_DESC_KEYS: Record<string, string> = {
  len: 'strLenDesc', find: 'strFindDesc', contains: 'strContainsDesc', left: 'strLeftDesc',
  right: 'strRightDesc', mid: 'strMidDesc', concat: 'strConcatDesc', insert: 'strInsertDesc',
  delete: 'strDeleteDesc', replace: 'strReplaceDesc', upper: 'strUpperDesc', lower: 'strLowerDesc',
  trim: 'strTrimDesc', reverse: 'strReverseDesc', format: 'strFormatDesc', parse: 'strParseDesc',
  encode_hex: 'strEncodeHexDesc',
};

function variantLabel(lang: Lang, variant: ModelVariant, labelKeys: Record<string, string>): string {
  const key = labelKeys[variant.id];
  return key ? t(lang, key) : variant.display.fallbackLabel;
}

function variantEntries(
  lang: Lang,
  model: ModelDescriptor | undefined,
  kind: PaletteEntry['kind'],
  icons: Record<string, LucideIcon>,
  labelKeys: Record<string, string>,
  fallbackIcon: LucideIcon,
  titleOf: (label: string, variant: ModelVariant) => string,
): PaletteEntry[] {
  if (!model) return [];
  return (model.variants ?? []).map((variant) => {
    const Icon = icons[variant.id] ?? fallbackIcon;
    const label = variantLabel(lang, variant, labelKeys);
    return {
      key: `${model.id}:${variant.id}`,
      kind,
      modelId: model.id,
      variantId: variant.id,
      documentLabel: variant.display.fallbackLabel,
      icon: <Icon size={14} />,
      label,
      title: titleOf(label, variant),
    };
  });
}

export interface BuildPaletteSectionsOptions {
  capabilityCards: DeviceCardModel[];
  openCustomEditor: () => void;
  /** 模型目录 — Math/Str/Filter 变体条目的来源 (目录未就绪时对应分组为空)。 */
  models: readonly ModelDescriptor[];
}

export function buildPaletteSections(
  lang: Lang,
  { capabilityCards, openCustomEditor, models }: BuildPaletteSectionsOptions,
): PaletteSection[] {
  const modelById = new Map(models.map((model) => [model.id, model]));

  const inputItems = entriesForKinds(lang, ['Knob', 'Button', 'Radio', 'Checkbox', 'Slider', 'Trigger', 'TextInput']);

  const displayItems = entriesForKinds(lang, ['Waveform', 'PieChart', 'Image', 'Gauge', 'Progress', 'LED', 'NumberDisplay', 'Label', 'Spectrum', 'Model3D', 'RawData', 'TextDisplay']);

  const mathItems = variantEntries(
    lang, modelById.get('widget:Math'), 'Math', MATH_VARIANT_ICONS, MATH_VARIANT_LABEL_KEYS, Sigma,
    (label, variant) => {
      const unary = (variant.configPatch as { inputCount?: number } | undefined)?.inputCount === 1;
      return `${label} (${t(lang, unary ? 'mathUnary' : 'mathBinary')})`;
    },
  );
  const filterItems = variantEntries(
    lang, modelById.get('widget:Filter'), 'Filter', FILTER_VARIANT_ICONS, FILTER_VARIANT_LABEL_KEYS, ArrowDownToLine,
    (label) => `${t(lang, 'filter')}: ${label}`,
  );
  const fftItems = entriesForKinds(lang, ['FFT', 'IFFT']);

  const strItems = variantEntries(
    lang, modelById.get('widget:Str'), 'Str', STR_VARIANT_ICONS, STR_VARIANT_LABEL_KEYS, Type,
    (label, variant) => {
      const descKey = STR_VARIANT_DESC_KEYS[variant.id];
      return descKey ? `${label} — ${t(lang, descKey)}` : label;
    },
  );

  const customItems: PaletteEntry[] = entriesForKinds(lang, ['Custom']).map((entry) => ({
    ...entry,
    onAdd: () => openCustomEditor(),
  }));

  const capabilityItems: PaletteEntry[] = capabilityCards.map((card) => ({
    key: `acquisition-${card.key}`,
    icon: <Cable size={14} />,
    label: card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName,
    title: card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName,
    nodeType: 'acquisition',
    acquisition: card,
  }));

  const protocolItems: PaletteEntry[] = [
    {
      key: 'protocol',
      nodeType: 'protocol' as const,
      icon: <Binary size={14} />,
      label: t(lang, 'protocolEngine'),
      title: t(lang, 'protocolEngine'),
    },
  ];

  return [
    { id: 'transport', header: categoryLabel(lang, 'transport'), category: 'transport', entries: capabilityItems },
    { id: 'protocol', header: categoryLabel(lang, 'protocol'), category: 'protocol', entries: [...protocolItems, ...entriesForKinds(lang, ['FrameDecoder']), { key: 'point-selector', nodeType: 'point-selector', icon: <ListOrdered size={14} />, label: t(lang, 'pointSelector'), title: t(lang, 'pointSelector') }] },
    { id: 'send', header: categoryLabel(lang, 'send'), category: 'send', entries: entriesForKinds(lang, ['Command', 'TextOut']) },
    { id: 'math', header: categoryLabel(lang, 'math'), category: 'math', entries: [...mathItems, ...filterItems, ...fftItems] },
    { id: 'string', header: categoryLabel(lang, 'string'), category: 'string', entries: strItems },
    { id: 'display', header: categoryLabel(lang, 'display'), category: 'display', entries: displayItems },
    { id: 'input', header: categoryLabel(lang, 'input'), category: 'input', entries: inputItems },
    { id: 'attributes', header: categoryLabel(lang, 'attributes'), category: 'custom', entries: [
      { key: 'test-data', attribute: 'test-data', icon: <Sigma size={14} />, label: t(lang, 'testData'), title: t(lang, 'testData') },
    ] },
    { id: 'custom', header: categoryLabel(lang, 'custom'), category: 'custom', entries: customItems },
  ];
}
