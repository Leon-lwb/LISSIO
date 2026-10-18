import { expect, test } from '@playwright/test';

test('window and node editor paint each background once in acrylic and opaque modes', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  await expect(page.locator('.node-editor-rf')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/store/settingsStore.ts';
    const { useSettingsStore } = await import(/* @vite-ignore */ path) as typeof import('../client/src/store/settingsStore');
    return useSettingsStore.getState().loaded;
  })).toBe(true);

  for (const acrylic of [true, false]) {
    const backgrounds = await page.evaluate(async enabled => {
      const appearancePath = '/src/settings/applyTheme.ts';
      const defaultsPath = '/src/settings/defaults.ts';
      const { applyAppearance } = await import(/* @vite-ignore */ appearancePath) as typeof import('../client/src/settings/applyTheme');
      const { DEFAULT_SETTINGS } = await import(/* @vite-ignore */ defaultsPath) as typeof import('../client/src/settings/defaults');
      applyAppearance({ ...DEFAULT_SETTINGS.appearance, acrylicBackground: enabled });

      const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
      const tokenColor = (token: string) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = `var(${token})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      };
      return {
        body: color('body'),
        editor: color('.node-editor-rf'),
        windowToken: tokenColor('--color-bg-window'),
        editorToken: tokenColor('--color-bg-editor'),
        descendants: ['html', '#root', '#root > div', '.node-editor-rf .react-flow', '.node-editor-rf .react-flow__background'].map(color),
      };
    }, acrylic);

    expect(backgrounds.body).toBe(backgrounds.windowToken);
    expect(backgrounds.editor).toBe(backgrounds.editorToken);
    expect(backgrounds.descendants).toEqual(Array<string>(5).fill('rgba(0, 0, 0, 0)'));
    expect(backgrounds.body.startsWith('rgba(')).toBe(acrylic);
    expect(backgrounds.editor.startsWith('rgba(')).toBe(acrylic);
  }

  // The setup screen replaces App's workbench. Its full-window wrapper must
  // likewise leave the body tint visible instead of compositing a second copy.
  await page.evaluate(async () => {
    const path = '/src/store/configGuideStore.ts';
    const { useConfigGuideStore } = await import(/* @vite-ignore */ path) as typeof import('../client/src/store/configGuideStore');
    useConfigGuideStore.setState({ isOpen: true });
  });
  await expect(page.locator('[aria-labelledby="config-guide-title"]')).toBeVisible();
  await expect(page.locator('#root > div')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
