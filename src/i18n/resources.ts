import { parse as parseYaml } from 'yaml';

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

type TranslationResources = Record<Lang, Record<string, string>>;

const rawModules: Record<string, string> = import.meta.glob('./resources/*/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function isLang(value: string): value is Lang {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function buildResources(): TranslationResources {
  const resources: TranslationResources = {
    zh: {},
    en: {},
  };

  for (const [path, raw] of Object.entries(rawModules).sort(([a], [b]) => a.localeCompare(b))) {
    const match = /^\.\/resources\/([^/]+)\/([^/]+)\.yml$/.exec(path);
    if (!match || !isLang(match[1])) {
      throw new Error(`[i18n] 无法识别的文案资源路径: ${path}`);
    }

    const parsed = parseYaml(raw) as Record<string, unknown> | null;
    if (!parsed || Array.isArray(parsed)) {
      throw new Error(`[i18n] 文案资源必须是 YAML 映射: ${path}`);
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`[i18n] 文案值必须是字符串: ${path}:${key}`);
      }
      if (key in resources[match[1]]) {
        throw new Error(`[i18n] 文案键重复: ${match[1]}:${key}`);
      }
      resources[match[1]][key] = String(value);
    }
  }

  const zhKeys = Object.keys(resources.zh).sort();
  const enKeys = Object.keys(resources.en).sort();
  if (zhKeys.length !== enKeys.length || zhKeys.some((key, index) => key !== enKeys[index])) {
    const missing = zhKeys.filter((key) => !(key in resources.en));
    const extra = enKeys.filter((key) => !(key in resources.zh));
    throw new Error(
      `[i18n] 中英文案键不一致 (缺少 en: ${missing.join(', ') || '无'}; 缺少 zh: ${extra.join(', ') || '无'})`
    );
  }

  return resources;
}

export const translationResources = buildResources();
