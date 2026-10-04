import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginRole } from './fixtures';

type SupplierOffer = { id: string; productName: string; warehouseName: string; stock: number };

test('Поставщик меняет остаток предложения и видит сохранённое значение', async ({ page }) => {
  await page.goto('/workspace');
  await loginRole(page, 'supplier');
  const response = await page.request.get('/api/v1/supplier/offers');
  expect(response.ok()).toBe(true);
  const offers: SupplierOffer[] = await response.json();
  const offer = offers.find(item => item.productName === 'Цемент М500 50 кг');
  expect(offer).toBeTruthy();
  const row = page.getByRole('article').filter({ has: page.getByRole('heading', { name: offer!.productName, exact: true }) }).filter({ hasText: offer!.warehouseName });
  try {
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Изменить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить предложение', exact: true });
    await dialog.getByLabel('Остаток', { exact: true }).fill(String(offer!.stock + 5));
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('Остаток', { exact: true }).locator('..').locator('dd')).toContainText(String(offer!.stock + 5));
    await page.reload();
    await expect(row.getByText('Остаток', { exact: true }).locator('..').locator('dd')).toContainText(String(offer!.stock + 5));
    await expect.poll(async () => {
      const fresh: SupplierOffer[] = await (await page.request.get('/api/v1/supplier/offers')).json();
      return fresh.find(item => item.id === offer!.id)?.stock;
    }).toBe(offer!.stock + 5);
  } finally {
    const current: SupplierOffer[] = await (await page.request.get('/api/v1/supplier/offers')).json();
    const restored = await page.request.patch(`/api/v1/supplier/offers/${offer!.id}`, {
      headers: { Origin: 'http://localhost:3100' }, data: { stock: offer!.stock, expectedStock: current.find(item => item.id === offer!.id)!.stock },
    });
    expect(restored.ok(), 'Исходный остаток должен быть восстановлен').toBe(true);
  }
});

test('Администратор создаёт товар и находит его в справочнике', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Проверка каталога ${suffix}`;
  await page.goto('/workspace');
  await loginRole(page, 'admin');
  const section = page.locator('.admin-section').filter({ has: page.getByRole('heading', { name: /Товары/ }) });
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: 'Товар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый товар' });
  await dialog.getByLabel('Название').fill(name);
  await dialog.getByLabel('Категория').selectOption({ label: 'Сухие смеси' });
  await dialog.getByLabel('Единица измерения').fill('мешок');
  await dialog.getByLabel('Адрес товара').fill(`proverka-${suffix}`);
  await dialog.getByLabel('Описание').fill('Товар для браузерного испытания справочника.');
  const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/products' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Сохранить товар' }).click();
  expect((await created).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Товар добавлен.' })).toBeVisible();
  await section.getByLabel('Поиск по названию или описанию').fill(name);
  await section.getByRole('button', { name: 'Найти' }).click();
  await expect(section.locator('.admin-product-row')).toHaveCount(1);
  await expect(section.locator('.admin-product-row')).toContainText(name);
});
