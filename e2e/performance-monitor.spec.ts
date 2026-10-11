import { expect, test } from '@playwright/test';

test('performance monitor opens and renders frontend and backend metrics', async ({ page }) => {
  let resumeHydration!: () => void;
  const hydrationGate = new Promise<void>((resolve) => { resumeHydration = resolve; });
  let workspaceRequested = false;
  await page.route('**/api/v1/rpc', async (route) => {
    const requests: unknown = route.request().postDataJSON();
    if (Array.isArray(requests) && requests.some((request: unknown) =>
      request !== null && typeof request === 'object' && 'cmd' in request && request.cmd === 'workspace_get'
    )) {
      workspaceRequested = true;
      await hydrationGate;
    }
    await route.continue();
  });
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  const entry = page.getByRole('button', { name: /性能监视器|Performance Monitor/ });
  try {
    await expect.poll(() => workspaceRequested).toBe(true);
    await expect(entry).toBeDisabled();
  } finally {
    resumeHydration();
  }
  await entry.click();

  const monitor = page.locator('[data-tour="performance-monitor"]');
  await expect(monitor).toBeVisible();
  await expect(monitor.getByText(/^(前端|Frontend)$/)).toBeVisible();
  await expect(monitor.getByText(/^(后端|Backend)$/)).toBeVisible();
  await expect(monitor.getByText(/^(帧率|FPS)$/)).toBeVisible();
  await expect(monitor.getByText(/^CPU$/)).toBeVisible();
  await expect(monitor.getByText(/^(JS Heap)$/).first()).toBeVisible();
});
