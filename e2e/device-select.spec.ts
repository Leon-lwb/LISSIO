import { expect, test } from '@playwright/test';

test('device choices stay readable across themes and retain keyboard selection', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  const finishTour = page.getByRole('button', { name: /结束引导|End tour/ });
  await expect(page.locator('[data-tour="devices"]')).toBeVisible();
  if (await finishTour.isVisible()) await finishTour.click();
  await page.locator('[data-tour="devices"]').click();
  const picker = page.getByTestId('device-tree-panel').getByRole('combobox').first();
  await expect(picker).toBeEnabled();

  for (const theme of ['dark', 'light', 'monet', 'custom-light']) {
    await page.evaluate(async id => {
      const path = '/src/settings/theme.ts';
      const { DARK_THEME, LIGHT_THEME, MONET_THEME } = await import(/* @vite-ignore */ path) as typeof import('../src/settings/theme');
      const appearancePath = '/src/settings/applyTheme.ts';
      const defaultsPath = '/src/settings/defaults.ts';
      const { applyAppearance } = await import(/* @vite-ignore */ appearancePath) as typeof import('../src/settings/applyTheme');
      const { DEFAULT_SETTINGS } = await import(/* @vite-ignore */ defaultsPath) as typeof import('../src/settings/defaults');
      const selected = id === 'light' ? LIGHT_THEME : id === 'monet' ? MONET_THEME
        : id === 'custom-light' ? { ...LIGHT_THEME, id, isBuiltIn: false } : DARK_THEME;
      applyAppearance({ ...DEFAULT_SETTINGS.appearance, theme: selected.id, customThemes: [selected], acrylicBackground: true });
    }, theme);
    await picker.click();
    const list = page.locator('.app-select-options');
    await expect(list).toBeVisible();
    await expect(list.getByRole('option', { name: 'Serial', exact: true })).toBeVisible();
    const colors = await list.evaluate(element => {
      const style = getComputedStyle(element);
      const active = getComputedStyle(element.querySelector('[data-active="true"]')!);
      return { foreground: style.color, background: style.backgroundColor,
        activeForeground: active.color, activeBackground: active.backgroundColor };
    });
    const luminance = (rgb: string) => {
      const channels = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const fg = luminance(colors.foreground);
    const bg = luminance(colors.background);
    expect((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)).toBeGreaterThan(4.5);
    const activeFg = luminance(colors.activeForeground);
    const activeBg = luminance(colors.activeBackground);
    expect((Math.max(activeFg, activeBg) + 0.05) / (Math.min(activeFg, activeBg) + 0.05)).toBeGreaterThan(4.5);
    expect(colors.background).toMatch(/^rgb\(/); // Opaque, even when window acrylic is enabled.
    const native = await page.evaluate(() => {
      const select = document.createElement('select');
      select.className = 'form-select';
      select.innerHTML = '<option>Modbus RTU</option>';
      document.body.appendChild(select);
      const style = getComputedStyle(select);
      const result = { appearance: style.appearance, foreground: style.color, background: style.backgroundColor };
      select.remove();
      return result;
    });
    expect(native.appearance).toBe('none');
    expect(native.background).toMatch(/^rgb\(/);
    const nativeFg = luminance(native.foreground);
    const nativeBg = luminance(native.background);
    expect((Math.max(nativeFg, nativeBg) + 0.05) / (Math.min(nativeFg, nativeBg) + 0.05)).toBeGreaterThan(4.5);
    const bounds = await list.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await picker.press('Escape');
  }

  await picker.focus();
  await picker.press('s');
  await picker.press('e');
  await picker.press('Enter');
  await expect(picker).toHaveText('Serial');
  await expect(picker).toBeFocused();
  await picker.press('ArrowDown');
  await picker.press('End');
  await picker.press('Escape');
  await expect(picker).toHaveText('Serial');
  await expect(page.locator('.app-select-options')).toBeHidden();
});
