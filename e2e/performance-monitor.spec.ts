import { expect, test } from '@playwright/test';

test('performance monitor opens and renders frontend and backend metrics', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  await page.getByRole('button', { name: /性能监视器|Performance Monitor/ }).click();

  const monitor = page.locator('[data-tour="performance-monitor"]');
  await expect(monitor).toBeVisible();
  await expect(monitor.getByText(/^(前端|Frontend)$/)).toBeVisible();
  await expect(monitor.getByText(/^(后端|Backend)$/)).toBeVisible();
  await expect(monitor.getByText(/^(帧率|FPS)$/)).toBeVisible();
  await expect(monitor.getByText(/^CPU$/)).toBeVisible();
  await expect(monitor.getByText(/^(JS Heap)$/).first()).toBeVisible();
});
