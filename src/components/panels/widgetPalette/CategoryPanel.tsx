import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useModelCatalogStore } from '../../../store/modelCatalogStore';
import { translate } from '../../../i18n';
import type { PaletteCategoryId } from '../../../types';
import type { PaletteEntry } from './paletteModel';
import { filterSections } from './paletteModel';
import { buildPaletteSections, CATEGORY_ICONS } from './paletteSections';
import { DevicePanel } from '../../acquisition/DevicePanel';
import { PaletteRow } from './PaletteRow';
import { loadAdapterCapabilities } from '../../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards, type DeviceCardModel } from '../../../lib/acquisition/deviceCardModel';
import { addPaletteNode } from '../../../lib/utils/paletteCreation';
import { SearchInput } from '../../ui/SearchInput';
import { motionIsReduced } from '../../../lib/motion';

export function CategoryPanel() {
  const lang = useAppStore((s) => s.lang);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const openCategory = useAppStore((s) => s.openCategory);
  const catalogModels = useModelCatalogStore((s) => s.models);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const scrollSelection = useRef<PaletteCategoryId | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [jumpRequest, setJumpRequest] = useState(0);
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
    () => buildPaletteSections(lang, { capabilityCards, openCustomEditor, models: catalogModels }),
    [lang, capabilityCards, openCustomEditor, catalogModels],
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
        const behavior = motionIsReduced() ? 'instant' : 'smooth';
        if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior });
        else list.scrollTop = top;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeCategory, jumpRequest, catalogPending, trimmedQuery]);

  const handleActivate = useCallback(
    (item: PaletteEntry) => {
      // Custom 条目 → 编辑器创建路径 (onAdd); 其余单一入口: test-data /
      // 结构节点 / 目录条目 (含变体) 由 addPaletteNode 分发, 创建走后端 prepare
      if (item.onAdd) {
        item.onAdd();
        return;
      }
      addPaletteNode(item, { x: item.nodeType === 'protocol' ? 300 : 280, y: 80 + Math.random() * 100 }, activeControlTabId);
    },
    [activeControlTabId],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden gap-1.5" data-tour="palette-root">
      <div className="relative flex-shrink-0 px-1">
        <SearchInput
          className="w-full"
          placeholder={translate('paletteSearchAll', lang)}
          value={searchQuery}
          onChange={(value) => {
            setSearchQuery(value);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          // ESC 清空后仍回调: 重置滚动跳转锚点, 让列表回到当前分类
          onEscape={() => {
            scrollSelection.current = null;
            setJumpRequest((value) => value + 1);
          }}
        />
      </div>

      <nav aria-label={translate('paletteJumpTo', lang)} className="flex flex-wrap gap-1 px-1 pb-2 border-b border-border-subtle">
        {sections.map((section) => (
          <button key={section.id} type="button" aria-current={activeCategory === section.id ? 'location' : undefined}
            onClick={() => { scrollSelection.current = null; openCategory(section.id); setJumpRequest((value) => value + 1); }}
            className={`inline-flex min-h-6 items-center rounded bg-clip-padding px-2 py-1 text-[11px] leading-none appearance-none transition-colors focus-visible:outline-accent ${activeCategory === section.id ? 'bg-bg-active text-text-bright' : 'text-text-secondary hover:bg-bg-hover'}`}>
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
                catalogPending ? <div role="status" className="flex justify-center gap-2 p-4 text-xs text-text-muted"><Loader2 size={14} className="motion-spin" />{translate('capabilityDiscovering', lang)}</div>
                  : catalogError ? <div role="alert" className="p-3 text-xs text-text-secondary">{translate('capabilityUnavailable', lang)}<button type="button" className="ml-2 text-accent" onClick={() => setCatalogAttempt((value) => value + 1)}>{translate('refresh', lang)}</button></div>
                    : <DevicePanel cards={capabilityCards} query={section.header.toLowerCase().includes(trimmedQuery) ? '' : trimmedQuery} />
              ) : filtered?.entries.map((entry) => (
                <PaletteRow key={entry.key} entry={entry} category={section.category}
                  entering={false} exiting={false} onActivate={handleActivate} onEnterPlayed={() => undefined} />
              ))}
            </section>
          );
        })}
        {trimmedQuery && filteredSections.length === 0 && (catalogError || catalogPending) && (
          <p role="status" className="p-3 text-xs text-text-secondary text-center">{translate('paletteNoResults', lang)}</p>
        )}
      </div>
    </div>
  );
}
