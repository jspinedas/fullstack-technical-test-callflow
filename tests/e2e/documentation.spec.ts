import { expect, test } from '@playwright/test';

test('Swagger UI carga recursos y prueba salud desde el mismo origen sin escribir datos', async ({ page }) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.url().includes('/api/docs/') && response.status() >= 400) failedAssets.push(response.url()); });
  await page.goto('/api/docs');
  await expect(page.getByRole('heading', { name: /Callflow API/ })).toBeVisible();
  await expect(page.locator('.opblock')).toHaveCount(5);
  const health = page.locator('.opblock').filter({ has: page.locator('[data-path="/api/health"]') });
  await health.locator('.opblock-summary').click();
  await health.getByRole('button', { name: 'Try it out' }).click();
  await health.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(health.locator('.responses-inner .response-col_status').filter({ hasText: /^200/ }).first()).toBeVisible();
  await expect(health.locator('.highlight-code').filter({ hasText: 'callflow-api' }).first()).toBeVisible();
  expect(errors).toEqual([]);
  expect(failedAssets).toEqual([]);
});
