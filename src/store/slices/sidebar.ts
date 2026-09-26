import type { Lang } from '../../i18n';
import type { PaletteCategoryId } from '../../types';
import type { AppSlice } from './types';

export type SidebarView = 'category' | 'quickstart' | 'panels' | 'recording' | 'devices';

export interface SidebarSlice {
  lang: Lang;
  setLang: (lang: Lang) => void;
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  activeCategory: PaletteCategoryId;
  selectedDeviceTreeNodeId: string | null;
  revealDeviceTreeNode: (nodeId: string) => void;
  setSidebarView: (view: SidebarView) => void;
  openCategory: (category: PaletteCategoryId) => void;
  selectCategory: (category: PaletteCategoryId) => void;
  toggleSidebar: (view: SidebarView) => void;
}

export const createSidebarSlice: AppSlice<SidebarSlice> = (set, get) => {
  return {
    lang: 'zh',
    setLang: (lang) => set({ lang }),

    sidebarView: 'category',
    sidebarVisible: true,
    activeCategory: 'transport',
    selectedDeviceTreeNodeId: null,
    revealDeviceTreeNode: (nodeId) => set({ selectedDeviceTreeNodeId: nodeId, sidebarView: 'devices', sidebarVisible: true }),
    setSidebarView: (view) => set({ sidebarView: view, sidebarVisible: true }),
    openCategory: (category) =>
      set({ sidebarView: 'category', activeCategory: category, sidebarVisible: true }),
    selectCategory: (category) => {
      const { sidebarView, sidebarVisible, activeCategory } = get();
      if (sidebarView === 'category' && activeCategory === category && sidebarVisible) {
        set({ sidebarVisible: false });
      } else {
        set({ sidebarView: 'category', activeCategory: category, sidebarVisible: true });
      }
    },
    toggleSidebar: (view) => {
      const { sidebarView, sidebarVisible } = get();
      if (sidebarView === view && sidebarVisible) {
        set({ sidebarVisible: false });
      } else {
        set({ sidebarView: view, sidebarVisible: true });
      }
    },
  };
}
