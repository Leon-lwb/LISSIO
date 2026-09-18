import { expect, test } from '@playwright/test';

test('Web without a reachable backend shows the connection diagnostic page', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:1&token=invalid');
  await expect(page.getByRole('heading', { name: '无法连接 Lissio 后端' })).toBeVisible();
  await expect(page.getByText('状态：unreachable')).toBeVisible();
});

test('Web authenticates with a real backend before mounting the application', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  await expect(page.getByRole('heading', { name: '无法连接 Lissio 后端' })).toBeHidden();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page).not.toHaveURL(/token=/);
});

test('an invalid token is distinguished from an unreachable server', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=wrong');
  await expect(page.getByText('访问令牌无效或缺失')).toBeVisible();
  await expect(page.getByText('状态：unauthorized')).toBeVisible();
});
