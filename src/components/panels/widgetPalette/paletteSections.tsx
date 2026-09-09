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
      icon: <def.icon size={14} />,
      label: t(lang, def.labelKey),
      title: t(lang, def.labelKey),
    };
  });
}

export interface BuildPaletteSectionsOptions {
  capabilityCards: DeviceCardModel[];
  openCustomEditor: () => void;
}

export function buildPaletteSections(
  lang: Lang,
  { capabilityCards, openCustomEditor }: BuildPaletteSectionsOptions,
): PaletteSection[] {
  const inputItems = entriesForKinds(lang, ['Knob', 'Button', 'Radio', 'Checkbox', 'Slider', 'Trigger', 'TextInput']);

  const displayItems = entriesForKinds(lang, ['Waveform', 'PieChart', 'Image', 'Gauge', 'Progress', 'LED', 'NumberDisplay', 'Label', 'Spectrum', 'Model3D', 'RawData', 'TextDisplay']);

  const mathItems: PaletteEntry[] = [
    { key: 'add', kind: 'Math', op: 'add', icon: <Plus />, label: t(lang, 'mathAdd'), title: `${t(lang, 'mathAdd')} (${t(lang, 'mathBinary')})` },
    { key: 'sub', kind: 'Math', op: 'sub', icon: <Minus />, label: t(lang, 'mathSub'), title: `${t(lang, 'mathSub')} (${t(lang, 'mathBinary')})` },
    { key: 'mul', kind: 'Math', op: 'mul', icon: <Square size={14} />, label: t(lang, 'mathMul'), title: `${t(lang, 'mathMul')} (${t(lang, 'mathBinary')})` },
    { key: 'div', kind: 'Math', op: 'div', icon: <Divide />, label: t(lang, 'mathDiv'), title: `${t(lang, 'mathDiv')} (${t(lang, 'mathBinary')})` },
    { key: 'avg', kind: 'Math', op: 'avg', icon: <Sigma />, label: t(lang, 'mathAvg'), title: `${t(lang, 'mathAvg')} (${t(lang, 'mathBinary')})` },
    { key: 'min', kind: 'Math', op: 'min', icon: <Sigma />, label: t(lang, 'mathMin'), title: `${t(lang, 'mathMin')} (${t(lang, 'mathBinary')})` },
    { key: 'max', kind: 'Math', op: 'max', icon: <Sigma />, label: t(lang, 'mathMax'), title: `${t(lang, 'mathMax')} (${t(lang, 'mathBinary')})` },
    { key: 'abs', kind: 'Math', op: 'abs', icon: <Sigma />, label: t(lang, 'mathAbs'), title: `${t(lang, 'mathAbs')} (${t(lang, 'mathUnary')})` },
    { key: 'neg', kind: 'Math', op: 'neg', icon: <Minus />, label: t(lang, 'mathNeg'), title: `${t(lang, 'mathNeg')} (${t(lang, 'mathUnary')})` },
    { key: 'square', kind: 'Math', op: 'square', icon: <Square size={14} />, label: t(lang, 'mathSquare'), title: `${t(lang, 'mathSquare')} (${t(lang, 'mathUnary')})` },
    { key: 'sqrt', kind: 'Math', op: 'sqrt', icon: <Sigma />, label: t(lang, 'mathSqrt'), title: `${t(lang, 'mathSqrt')} (${t(lang, 'mathUnary')})` },
    { key: 'sin', kind: 'Math', op: 'sin', icon: <Sigma />, label: t(lang, 'mathSin'), title: `${t(lang, 'mathSin')} (${t(lang, 'mathUnary')})` },
    { key: 'cos', kind: 'Math', op: 'cos', icon: <Sigma />, label: t(lang, 'mathCos'), title: `${t(lang, 'mathCos')} (${t(lang, 'mathUnary')})` },
    { key: 'tan', kind: 'Math', op: 'tan', icon: <Sigma />, label: t(lang, 'mathTan'), title: `${t(lang, 'mathTan')} (${t(lang, 'mathUnary')})` },
    { key: 'log', kind: 'Math', op: 'log', icon: <Sigma />, label: t(lang, 'mathLog'), title: `${t(lang, 'mathLog')} (${t(lang, 'mathUnary')})` },
  ];

  const filterItems: PaletteEntry[] = [
    { key: 'Lowpass', kind: 'Filter', preset: 'Lowpass', icon: <ArrowDownToLine />, label: t(lang, 'filterLowpass'), title: `${t(lang, 'filter')}: ${t(lang, 'filterLowpass')}` },
    { key: 'Highpass', kind: 'Filter', preset: 'Highpass', icon: <ArrowUpToLine />, label: t(lang, 'filterHighpass'), title: `${t(lang, 'filter')}: ${t(lang, 'filterHighpass')}` },
    { key: 'Bandpass', kind: 'Filter', preset: 'Bandpass', icon: <ArrowRightLeft />, label: t(lang, 'filterBandpass'), title: `${t(lang, 'filter')}: ${t(lang, 'filterBandpass')}` },
    { key: 'Bandstop', kind: 'Filter', preset: 'Bandstop', icon: <Ban />, label: t(lang, 'filterBandstop'), title: `${t(lang, 'filter')}: ${t(lang, 'filterBandstop')}` },
  ];

  const fftItems = entriesForKinds(lang, ['FFT', 'IFFT']);

  const strItems: PaletteEntry[] = [
    { key: 'str-len', kind: 'Str', op: 'len', icon: <Ruler size={14} />, label: t(lang, 'strLen'), title: `${t(lang, 'strLen')} — ${t(lang, 'strLenDesc')}` },
    { key: 'str-find', kind: 'Str', op: 'find', icon: <TextSearch size={14} />, label: t(lang, 'strFind'), title: `${t(lang, 'strFind')} — ${t(lang, 'strFindDesc')}` },
    { key: 'str-contains', kind: 'Str', op: 'contains', icon: <Search size={14} />, label: t(lang, 'strContains'), title: `${t(lang, 'strContains')} — ${t(lang, 'strContainsDesc')}` },
    { key: 'str-left', kind: 'Str', op: 'left', icon: <ArrowLeftToLine size={14} />, label: t(lang, 'strLeft'), title: `${t(lang, 'strLeft')} — ${t(lang, 'strLeftDesc')}` },
    { key: 'str-right', kind: 'Str', op: 'right', icon: <ArrowRightToLine size={14} />, label: t(lang, 'strRight'), title: `${t(lang, 'strRight')} — ${t(lang, 'strRightDesc')}` },
    { key: 'str-mid', kind: 'Str', op: 'mid', icon: <Scissors size={14} />, label: t(lang, 'strMid'), title: `${t(lang, 'strMid')} — ${t(lang, 'strMidDesc')}` },
    { key: 'str-concat', kind: 'Str', op: 'concat', icon: <Link2 size={14} />, label: t(lang, 'strConcat'), title: `${t(lang, 'strConcat')} — ${t(lang, 'strConcatDesc')}` },
    { key: 'str-insert', kind: 'Str', op: 'insert', icon: <TextCursorInput size={14} />, label: t(lang, 'strInsert'), title: `${t(lang, 'strInsert')} — ${t(lang, 'strInsertDesc')}` },
    { key: 'str-delete', kind: 'Str', op: 'delete', icon: <Delete size={14} />, label: t(lang, 'strDelete'), title: `${t(lang, 'strDelete')} — ${t(lang, 'strDeleteDesc')}` },
    { key: 'str-replace', kind: 'Str', op: 'replace', icon: <Replace size={14} />, label: t(lang, 'strReplace'), title: `${t(lang, 'strReplace')} — ${t(lang, 'strReplaceDesc')}` },
    { key: 'str-upper', kind: 'Str', op: 'upper', icon: <CaseUpper size={14} />, label: t(lang, 'strUpper'), title: `${t(lang, 'strUpper')} — ${t(lang, 'strUpperDesc')}` },
    { key: 'str-lower', kind: 'Str', op: 'lower', icon: <CaseLower size={14} />, label: t(lang, 'strLower'), title: `${t(lang, 'strLower')} — ${t(lang, 'strLowerDesc')}` },
    { key: 'str-trim', kind: 'Str', op: 'trim', icon: <Eraser size={14} />, label: t(lang, 'strTrim'), title: `${t(lang, 'strTrim')} — ${t(lang, 'strTrimDesc')}` },
    { key: 'str-reverse', kind: 'Str', op: 'reverse', icon: <ArrowLeftRight size={14} />, label: t(lang, 'strReverse'), title: `${t(lang, 'strReverse')} — ${t(lang, 'strReverseDesc')}` },
    { key: 'str-format', kind: 'Str', op: 'format', icon: <Braces size={14} />, label: t(lang, 'strFormat'), title: `${t(lang, 'strFormat')} — ${t(lang, 'strFormatDesc')}` },
    { key: 'str-parse', kind: 'Str', op: 'parse', icon: <ListOrdered size={14} />, label: t(lang, 'strParse'), title: `${t(lang, 'strParse')} — ${t(lang, 'strParseDesc')}` },
    { key: 'str-encode-hex', kind: 'Str', op: 'encode_hex', icon: <Binary size={14} />, label: t(lang, 'strEncodeHex'), title: `${t(lang, 'strEncodeHex')} — ${t(lang, 'strEncodeHexDesc')}` },
  ];

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
