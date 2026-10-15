import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../test/renderWithI18n';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { applyAppearance } from '../../settings/applyTheme';
import { DARK_THEME, LIGHT_THEME, type ThemeDefinition } from '../../settings/theme';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ThemeEditor } from '../ThemeEditor';

vi.mock('liquid-gl', () => ({ default: null }));

const DRAFT: ThemeDefinition = {
  ...LIGHT_THEME,
  id: 'light-draft',
  name: 'Light draft',
  isBuiltIn: false,
  tokens: { ...LIGHT_THEME.tokens },
};

// Use the same settings callbacks as SettingsModal: they apply the palette and
// acrylic appearance together. Mocking them would hide a later raw-token write.
function Harness() {
  const appearance = useSettingsStore((state) => state.settings.appearance);
  const update = useSettingsStore((state) => state.update);
  return (
    <ThemeEditor
      isOpen
      onClose={() => undefined}
      themes={appearance.customThemes}
      onThemesChange={(themes) => update('appearance', 'customThemes', themes)}
      activeThemeId={appearance.theme}
      onActiveThemeChange={(id) => update('appearance', 'theme', id)}
      cssThemes={appearance.customCssThemes}
      onCssThemesChange={(themes) => update('appearance', 'customCssThemes', themes)}
      activeCssThemeId={appearance.cssTheme}
      onActiveCssThemeChange={(id) => update('appearance', 'cssTheme', id)}
    />
  );
}

function appearance() {
  return useSettingsStore.getState().settings.appearance;
}

function expectAcrylicWindow(rgb: [number, number, number]) {
  const token = document.documentElement.style.getPropertyValue('--color-bg-window');
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(token);
  expect(rgba, token).not.toBeNull();
  expect(rgba!.slice(1, 4).map(Number)).toEqual(rgb);
  expect(Number(rgba![4])).toBeGreaterThan(0);
  expect(Number(rgba![4])).toBeLessThan(1);
  expect(document.documentElement.dataset.acrylic).toBe('true');
}

beforeEach(() => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.appearance.customThemes = [structuredClone(DRAFT)];
  settings.appearance.reducedMotion = true;
  settings.appearance.acrylicBackground = true;
  useAppStore.setState({ lang: 'en' });
  useSettingsStore.setState({ settings, loaded: true, loadError: null, saveError: null, saving: false });
  applyAppearance(settings.appearance);
});

afterEach(async () => {
  cleanup();
  // Flush the real store's debounce before the next test replaces its settings.
  await useSettingsStore.getState().save();
  applyAppearance(DEFAULT_SETTINGS.appearance);
});

describe('ThemeEditor appearance integration', () => {
  it('creates and activates a theme without replacing acrylic tokens with raw colors', () => {
    renderWithI18n(<Harness />);
    fireEvent.click(screen.getByTitle('New Theme'));

    const created = appearance().customThemes.find((theme) => theme.id === appearance().theme);
    expect(created?.tokens.bgWindow).toBe(DARK_THEME.tokens.bgWindow);
    expectAcrylicWindow([13, 16, 22]);
  });

  it('activates a selected custom theme through the appearance settings', () => {
    renderWithI18n(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: DRAFT.name }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate Theme' }));

    expect(appearance().theme).toBe(DRAFT.id);
    expectAcrylicWindow([240, 240, 240]);
  });

  it('previews edits to the active theme and preserves acrylic when resetting or deleting it', () => {
    useSettingsStore.getState().update('appearance', 'theme', DRAFT.id);
    renderWithI18n(<Harness />);
    fireEvent.change(screen.getByTitle('bgWindow'), { target: { value: '#112233' } });

    expect(appearance().customThemes[0].tokens.bgWindow).toBe('#112233');
    expectAcrylicWindow([17, 34, 51]);

    fireEvent.click(screen.getByTitle('Reset to Default'));
    expect(appearance().customThemes[0].tokens.bgWindow).toBe(DARK_THEME.tokens.bgWindow);
    expectAcrylicWindow([13, 16, 22]);

    fireEvent.click(screen.getByTitle('Delete'));
    expect(appearance().theme).toBe(DARK_THEME.id);
    expect(appearance().customThemes).toHaveLength(0);
    expectAcrylicWindow([13, 16, 22]);
  });

  it('edits and duplicates an inactive theme without changing the active preview', () => {
    renderWithI18n(<Harness />);
    const activeWindow = document.documentElement.style.getPropertyValue('--color-bg-window');
    fireEvent.click(screen.getByRole('button', { name: DRAFT.name }));
    fireEvent.change(screen.getByTitle('bgWindow'), { target: { value: '#112233' } });
    fireEvent.click(screen.getByTitle('Duplicate'));

    expect(appearance().customThemes.map((theme) => theme.tokens.bgWindow)).toEqual(['#112233', '#112233']);
    expect(appearance().theme).toBe(DARK_THEME.id);
    expect(document.documentElement.style.getPropertyValue('--color-bg-window')).toBe(activeWindow);
  });

  it('imports and activates a theme without discarding acrylic appearance', async () => {
    const { container } = renderWithI18n(<Harness />);
    const file = new File([JSON.stringify({ ...DRAFT, name: 'Imported light' })], 'theme.json', {
      type: 'application/json',
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    await waitFor(() => {
      const imported = appearance().customThemes.find((theme) => theme.id === appearance().theme);
      expect(imported?.name).toBe('Imported light');
    });
    expectAcrylicWindow([240, 240, 240]);
  });

  it('keeps an opaque palette when acrylic is disabled', () => {
    useSettingsStore.getState().update('appearance', 'acrylicBackground', false);
    useSettingsStore.getState().update('appearance', 'theme', DRAFT.id);
    renderWithI18n(<Harness />);
    fireEvent.change(screen.getByTitle('bgWindow'), { target: { value: '#112233' } });

    expect(document.documentElement.style.getPropertyValue('--color-bg-window')).toBe('#112233');
    expect(document.documentElement.dataset.acrylic).toBeUndefined();
  });
});
