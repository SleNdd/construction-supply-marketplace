import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginBuyer } from './fixtures';

test('Настоящий UI покупателя: уникальный объект, материал, корзина, заказ и восстановление остатка отменой', async ({ page }) => {
  const projectName = `E2E объект ${randomUUID()}`;
  const address = 'Астрахань, ул. Савушкина, 6';
  let orderId: string | undefined;
  let cancelled = false;
  await page.goto('/catalog');
  await loginBuyer(page);
  const productsResponse = await page.request.get('/api/v1/products?inStock=true&limit=100');
  expect(productsResponse.ok()).toBe(true);
  const products = (await productsResponse.json()).items;
  expect(products.length).toBeGreaterThan(0);
  const product = products[0];
  const detailsResponse = await page.request.get(`/api/v1/products/${product.id}`);
  expect(detailsResponse.ok()).toBe(true);
  const details = await detailsResponse.json();
  const offer = details.offers.find((item: { stock: number }) => item.stock > 0);
  expect(offer).toBeTruthy();
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Новый объект', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Новый объект', exact: true });
  await create.getByLabel('Название', { exact: true }).fill(projectName);
  await create.getByLabel('Адрес', { exact: true }).fill(address);
  await create.getByRole('button', { name: 'Создать объект', exact: true }).click();
  await expect(create).toBeHidden();
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: projectName, exact: true }) }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('button', { name: 'Добавить материал', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Добавить материал', exact: true });
  await expect(add.getByRole('combobox', { name: 'Товар', exact: true }).locator(`option[value="${product.id}"]`)).toHaveCount(1);
  await add.getByRole('combobox', { name: 'Товар', exact: true }).selectOption(product.id);
  await add.getByLabel('Количество', { exact: true }).fill('1');
  await add.getByRole('button', { name: 'Добавить в перечень', exact: true }).click();
  await expect(add).toBeHidden();
  await expect(page.locator('.needs-list')).toContainText(product.name);
  await page.goto(`/product/${product.id}`);
  const row = page.locator('.offer-row').filter({ hasText: offer.supplierName });
  await row.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByRole('link', { name: 'Корзина, товаров: 1', exact: true }).click();
  await page.getByLabel('Адрес доставки', { exact: true }).fill(address);
  await page.getByRole('button', { name: 'Рассчитать доставку', exact: true }).click();
  await page.getByRole('link', { name: 'Оформить заказ', exact: true }).click();
  await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue(address);
  await page.getByRole('combobox').selectOption(projectId);
  await expect(page.getByRole('button', { name: 'Подтвердить заказ', exact: true })).toBeEnabled();
  const orderResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/orders' && response.request().method() === 'POST');
  try {
    await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
    const response = await orderResponse;
    expect(response.ok()).toBe(true);
    orderId = (await response.json()).id;
    expect(response.request().postDataJSON().projectId).toBe(projectId);
    await expect(page).toHaveURL(`/orders/${orderId}`);
    await expect(page.getByText('Ожидает демооплату', { exact: true })).toBeVisible();
    const reserved = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
    expect(reserved.offers.find((item: { id: string }) => item.id === offer.id).stock).toBe(offer.stock - 1);
    await page.getByRole('button', { name: 'Отменить заказ', exact: true }).click();
    await expect(page.getByText('Отменён', { exact: true })).toBeVisible();
    cancelled = true;
    const restored = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
    expect(restored.offers.find((item: { id: string }) => item.id === offer.id).stock).toBe(offer.stock);
  } finally {
    // Восстанавливаем только собственный резерв теста при прерывании сценария проверкой.
    if (orderId && !cancelled) {
      const recovery = await page.request.post(`/api/v1/orders/${orderId}/cancel`, { headers: { Origin: new URL(page.url()).origin } });
      expect(recovery.ok(), `restore own E2E order ${orderId}`).toBe(true);
    }
  }
});
