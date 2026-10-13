import { expect, test } from '@playwright/test';

test('tab content keeps backdrop sampling stable through animation completion', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  const bar = page.locator('[data-tour="data-tabs"][data-dock-card="data-main"]');
  await expect(bar).toBeVisible();
  const samples = await bar.evaluate(async element => {
    const wrapper = element.parentElement!.querySelector<HTMLElement>('.motion-switch')!;
    const tabs = [...element.querySelectorAll('[data-tab-key]')] as HTMLElement[];
    // The current tab has the bright text class; select another real data tab.
    const target = tabs.find(tab => !tab.classList.contains('text-text-bright'))!;
    const frames: { opacity: string; transform: string; animations: number }[] = [];
    let observed = false;
    let settled = 0;
    const deadline = performance.now() + 5000;
    target.click();
    while (performance.now() < deadline) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const style = getComputedStyle(wrapper);
      const animations = wrapper.getAnimations().length;
      frames.push({ opacity: style.opacity, transform: style.transform, animations });
      observed ||= animations > 0;
      settled = observed && animations === 0 ? settled + 1 : 0;
      if (settled >= 6) break;
    }
    return { frames, inline: wrapper.style.cssText };
  });
  expect(samples.frames.some(frame => frame.animations > 0)).toBe(true);
  expect(samples.frames.every(frame => frame.opacity === '1')).toBe(true);
  expect(samples.frames.some(frame => frame.transform !== 'none')).toBe(true);
  expect(samples.frames.slice(-6).every(frame => frame.animations === 0 && frame.transform === 'none')).toBe(true);
  expect(samples.inline).toBe('');
});

test('CSS themes retain the active sheet during a delayed replacement', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  await expect(page.locator('[data-tour="data-tabs"][data-dock-card="data-main"]')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/store/settingsStore.ts';
    const { useSettingsStore } = await import(/* @vite-ignore */ path) as typeof import('../src/store/settingsStore');
    return useSettingsStore.getState().loaded;
  })).toBe(true);
  await page.route('**/themes/handoff-a.css', route => route.fulfill({ contentType: 'text/css', body: ':root { --handoff-probe: a; }' }));
  let release = () => undefined as void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/themes/handoff-b.css', async route => {
    await released;
    await route.fulfill({ contentType: 'text/css', body: ':root { --handoff-probe: b; }' });
  });
  const load = async (id: string) => page.evaluate(async themeId => {
    const path = '/src/settings/css-theme-loader.ts';
    const { loadCssTheme } = await import(/* @vite-ignore */ path) as typeof import('../src/settings/css-theme-loader');
    loadCssTheme({ id: themeId, name: themeId, isBuiltIn: false, url: `/themes/${themeId}.css` });
  }, id);
  await load('handoff-a');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--handoff-probe').trim())).toBe('a');
  await page.evaluate(() => { document.getElementById('css-theme-handoff-a')!.setAttribute('data-original', 'true'); });
  await load('handoff-a');
  await expect(page.locator('#css-theme-handoff-a')).toHaveAttribute('data-original', 'true');
  const request = page.waitForRequest('**/themes/handoff-b.css');
  await load('handoff-b');
  await request;
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--handoff-probe').trim())).toBe('a');
  await expect(page.locator('#css-theme-handoff-a')).toBeAttached();
  await expect(page.locator('#css-theme-handoff-b-pending')).toHaveAttribute('media', 'not all');
  release();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--handoff-probe').trim())).toBe('b');
  await expect(page.locator('#css-theme-handoff-a')).toHaveCount(0);
  await expect(page.locator('#css-theme-handoff-b')).toHaveAttribute('media', 'all');
});
