import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { createWidget } from '../../../lib/utils/widgetDefaults';
import { t } from '../../../i18n';
import type { WidgetConfig, MathOp, StrOp, PaletteCategoryId } from '../../../types';
import { isUnaryMathOp } from '../../../types';
import type { PaletteEntry } from './paletteModel';
import { filterSections } from './paletteModel';
import { buildPaletteSections, CATEGORY_ICONS } from './paletteSections';
import { DevicePanel } from '../../acquisition/DevicePanel';
import { PaletteRow } from './PaletteRow';
import { loadAdapterCapabilities } from '../../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards, type DeviceCardModel } from '../../../lib/acquisition/deviceCardModel';
import { applyTestAttribute } from '../../../lib/acquisition/simulation';
import { addPaletteNode } from '../../../lib/utils/paletteCreation';

export function CategoryPanel() {
  const lang = useAppStore((s) => s.lang);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const openCategory = useAppStore((s) => s.openCategory);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const scrollSelection = useRef<PaletteCategoryId | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [jumpRequest, setJumpRequest] = useState(0);
  const addWidget = useAppStore((s) => s.addWidget);
  const activeControlTabId = useAppStore((s) => s.activeControlTabId);
  const openCustomEditor = useAppStore((s) => s.openCustomEditor);
  const [capabilityCards, setCapabilityCards] = useState<DeviceCardModel[]>([]);
  const [catalogPending, setCatalogPending] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const trimmedQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    let active = true;
    setCatalogPending(true);
    setCatalogError(false);
    void loadAdapterCapabilities()
      .then((capabilities) => {
        if (active) setCapabilityCards(buildDeviceCards(capabilities));
      })
      .catch(() => {
        if (active) setCatalogError(true);
      }).finally(() => { if (active) setCatalogPending(false); });
    return () => { active = false; };
  }, [catalogAttempt]);

  const sections = useMemo(
    () => buildPaletteSections(lang, { capabilityCards, openCustomEditor }),
    [lang, capabilityCards, openCustomEditor],
  );

  const filteredSections = useMemo(() => filterSections(sections, trimmedQuery), [sections, trimmedQuery]);

  const syncScrollCategory = () => {
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    let current: PaletteCategoryId | undefined;
    for (const section of sections) {
      const element = sectionRefs.current.get(section.id);
      if (!element) continue;
      current ??= section.id;
      if (element.getBoundingClientRect().top > top + 2) break;
      current = section.id;
    }
    if (!current) return;
    // Scroll tracking updates shared navigation without triggering another jump.
    scrollSelection.current = current;
    if (useAppStore.getState().activeCategory !== current) {
      useAppStore.setState({ activeCategory: current });
    }
  };

  // Category navigation always returns to the full directory before positioning it.
  useEffect(() => {
    if (scrollSelection.current === activeCategory) return;
    setSearchQuery('');
  }, [activeCategory, jumpRequest]);

  useEffect(() => {
    if (trimmedQuery || scrollSelection.current === activeCategory) return;
    const frame = requestAnimationFrame(() => {
      if (scrollSelection.current === activeCategory) return;
      const list = listRef.current;
      const section = sectionRefs.current.get(activeCategory);
      if (list && section) {
        const top = list.scrollTop + section.getBoundingClientRect().top - list.getBoundingClientRect().top;
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior });
        else list.scrollTop = top;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeCategory, jumpRequest, catalogPending, trimmedQuery]);

  const handleActivate = useCallback(
    (item: PaletteEntry) => {
      if (item.attribute === 'test-data') { applyTestAttribute(); return; }
      if (item.onAdd) {
        item.onAdd();
        return;
      }
      if (addPaletteNode(item, { x: item.nodeType === 'protocol' ? 300 : 60, y: 60 + Math.random() * 60 })) return;
      if (!item.kind) return;
      const kind = item.kind;
      const widget = createWidget(kind);
      if (kind === 'Math' && item.op) {
        const mathWidget = widget as Extract<WidgetConfig, { kind: 'Math' }>;
        mathWidget.params.op = item.op as MathOp;
        if (isUnaryMathOp(item.op as MathOp)) {
          mathWidget.params.inputCount = 1;
        }
        mathWidget.params.label = `Math ${item.op}`;
      }
      if (kind === 'Str' && item.op) {
        const strWidget = widget as Extract<WidgetConfig, { kind: 'Str' }>;
        strWidget.params.op = item.op as StrOp;
        strWidget.params.label = `Str ${item.op}`;
      }
      if (kind === 'Filter' && item.preset) {
        const filterWidget = widget as Extract<WidgetConfig, { kind: 'Filter' }>;
        filterWidget.params.preset = item.preset;
        filterWidget.params.label = `Filter ${item.preset}`;
      }
      addWidget(widget, activeControlTabId, { x: 280, y: 80 + Math.random() * 100 });
    },
    [addWidget, activeControlTabId],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden gap-1.5" data-tour="palette-root">
      <div className="relative flex-shrink-0 px-1">
        <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
          onKeyDown={(e) => { if (e.key === 'Escape') { scrollSelection.current = null; setSearchQuery(''); setJumpRequest((value) => value + 1); } }}
          aria-label={t(lang, 'paletteSearchAll')}
          placeholder={t(lang, 'paletteSearchAll')}
          className="w-full pl-6 pr-6 py-1 text-xs bg-bg-input text-text-primary border border-border rounded-sm focus:outline-none focus:border-accent placeholder:text-text-disabled"
        />
        {searchQuery && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-primary"
            onClick={() => setSearchQuery('')}
            title={t(lang, 'paletteClearSearch')}
          >
            <X size={11} />
          </button>
        )}
      </div>

      <nav aria-label={t(lang, 'paletteJumpTo')} className="flex flex-wrap gap-1 px-1 pb-2 border-b border-border-subtle">
        {sections.map((section) => (
          <button key={section.id} type="button" aria-current={activeCategory === section.id ? 'location' : undefined}
            onClick={() => { scrollSelection.current = null; openCategory(section.id); setJumpRequest((value) => value + 1); }}
            className={`rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline-accent ${activeCategory === section.id ? 'bg-bg-active text-text-bright' : 'text-text-secondary hover:bg-bg-hover'}`}>
            {section.header}
          </button>
        ))}
      </nav>
      <div ref={listRef} onScroll={syncScrollCategory} className="flex-1 min-h-0 overflow-y-auto" data-tour="palette-list">
        {sections.map((section) => {
          const filtered = filteredSections.find((item) => item.id === section.id);
          const Icon = CATEGORY_ICONS[section.id];
          // Keep device discovery mounted: its search also covers hardware metadata.
          if (section.id !== 'transport' && !filtered) return null;
          return (
            <section key={section.id} ref={(element) => { if (element) sectionRefs.current.set(section.id, element); else sectionRefs.current.delete(section.id); }}
              aria-labelledby={`palette-heading-${section.id}`} className="pb-4 last:min-h-full">
              <h3 id={`palette-heading-${section.id}`} className="sticky top-0 z-10 flex items-center gap-2 bg-bg-sidebar px-1.5 py-2 text-xs font-semibold text-text-primary border-b border-border-subtle mb-1">
                <Icon size={13} /><span className="flex-1">{section.header}</span>
                {section.id !== 'transport' && <span aria-hidden="true" className="text-text-muted font-normal tabular-nums">{filtered?.entries.length}</span>}
              </h3>
              {section.id === 'transport' ? (
                catalogPending ? <div role="status" className="flex justify-center gap-2 p-4 text-xs text-text-muted"><Loader2 size={14} className="animate-spin" />{t(lang, 'capabilityDiscovering')}</div>
                  : catalogError ? <div role="alert" className="p-3 text-xs text-text-secondary">{t(lang, 'capabilityUnavailable')}<button type="button" className="ml-2 text-accent" onClick={() => setCatalogAttempt((value) => value + 1)}>{t(lang, 'refresh')}</button></div>
                    : <DevicePanel cards={capabilityCards} query={section.header.toLowerCase().includes(trimmedQuery) ? '' : trimmedQuery} />
              ) : filtered?.entries.map((entry) => (
                <PaletteRow key={entry.key} entry={entry} category={section.category}
                  entering={false} exiting={false} onActivate={handleActivate} onEnterPlayed={() => undefined} />
              ))}
            </section>
          );
        })}
        {trimmedQuery && filteredSections.length === 0 && (catalogError || catalogPending) && (
          <p role="status" className="p-3 text-xs text-text-secondary text-center">{t(lang, 'paletteNoResults')}</p>
        )}
      </div>
    </div>
  );
}
