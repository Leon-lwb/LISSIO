//! Platform file, dialog, and process services. Settings always use the connected backend.

import { hasTauriRuntime } from '../rpc';
import { tauriPlatform } from './tauri';
import { webPlatform } from './web';
import type { Platform } from './types';

export const platform: Platform = hasTauriRuntime() ? tauriPlatform : webPlatform;

export type { FileFilter, Platform, PlatformStore } from './types';
