import type { ReactNode } from 'react';
import { Bell, Database, Gauge, Palette, Settings as SettingsIcon, Sliders, Sparkles, Usb } from 'lucide-react';
import type { AppSettings } from '../settings/defaults';

export const CATEGORY_ICONS: Record<keyof AppSettings, ReactNode> = {
  general: <SettingsIcon size={16} />,
  appearance: <Palette size={16} />,
  editor: <Sliders size={16} />,
  data: <Database size={16} />,
  serial: <Usb size={16} />,
  notifications: <Bell size={16} />,
  performance: <Gauge size={16} />,
  ai: <Sparkles size={16} />,
};

export const CATEGORY_LABEL_KEY: Record<keyof AppSettings, string> = {
  general: 'settingsGeneral',
  appearance: 'settingsAppearance',
  editor: 'settingsEditor',
  data: 'settingsData',
  serial: 'settingsSerial',
  notifications: 'settingsNotifications',
  performance: 'settingsPerformance',
  ai: 'settingsAi',
};
