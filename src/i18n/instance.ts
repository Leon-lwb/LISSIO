import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  SUPPORTED_LANGUAGES,
  translationResources,
  type Lang,
} from './resources';

export type TranslationKey = string;

export const i18n = i18next;

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: translationResources.zh },
    en: { translation: translationResources.en },
  },
  lng: 'zh',
  fallbackLng: 'zh',
  supportedLngs: SUPPORTED_LANGUAGES,
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnNull: false,
  parseMissingKeyHandler: (key) => key,
});

export function currentLanguage(): Lang {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.resolvedLanguage ?? '')
    ? (i18n.resolvedLanguage as Lang)
    : 'zh';
}

/** 非 React 代码的命令式翻译入口；React 组件优先使用 useTranslation。
 *
 * `vars` 供带占位符的文案使用 (如 `端口 {{port}} 被占用`)。 */
export function translate(
  key: TranslationKey,
  lang: Lang = currentLanguage(),
  vars?: Record<string, unknown>
): string {
  return i18n.t(key, { lng: lang, defaultValue: key, ...vars });
}

/** 同步 i18next 当前语言，并同步 HTML lang，设置存储仍是产品配置来源。 */
export function changeLanguage(lang: Lang): Promise<void> {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  return i18n.changeLanguage(lang).then(() => undefined);
}
