import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('webhook → PostgreSQL → Redis → SSE → React y spam entre sesiones', async ({ page, context, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByText('En vivo', { exact: true })).toBeVisible();
  const secondPage = await context.newPage(); await secondPage.goto('/');
  await expect(secondPage.getByText('En vivo', { exact: true })).toBeVisible();
  const callId = `e2e-${randomUUID()}`;
  const payload = { callId, phoneNumber: '+12025550180', agent: 'Agente validación E2E', duration: 125, recordingUrl: 'https://example.com/audio.mp3' };
  const created = await request.post('/api/webhooks/calls', { data: payload });
  expect(created.status()).toBe(201);
  const row = page.locator(`[data-call-id="${callId}"]`);
  const secondRow = secondPage.locator(`[data-call-id="${callId}"]`);
  await expect(row).toBeVisible(); await expect(secondRow).toBeVisible();
  await expect(row.getByText('2 min 05 s')).toBeVisible();
  expect((await request.post('/api/webhooks/calls', { data: { ...payload, phoneNumber: '+12025550181' } })).status()).toBe(200);
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /Marcar .* como spam/ }).click();
  await expect(row.getByText('Spam', { exact: true })).toBeVisible();
  await expect(secondRow.getByText('Spam', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('EventSource reconecta y REST recupera una llamada recibida durante la desconexión', async ({ page, request }) => {
  await page.route('**/api/calls/events', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('Reconectando', { exact: true })).toBeVisible();
  await expect(page.getByText('Cargando llamadas…')).toHaveCount(0);
  const callId = `e2e-reconnect-${randomUUID()}`;
  expect((await request.post('/api/webhooks/calls', { data: { callId, phoneNumber: '+12025550182', agent: 'Agente reconexión', duration: 30 } })).status()).toBe(201);
  await expect(page.locator(`[data-call-id="${callId}"]`)).toHaveCount(0);
  await page.unroute('**/api/calls/events');
  await expect(page.getByText('En vivo', { exact: true })).toBeVisible();
  await expect(page.locator(`[data-call-id="${callId}"]`)).toBeVisible();
  await expect(page.locator(`[data-call-id="${callId}"]`)).toHaveCount(1);
});
