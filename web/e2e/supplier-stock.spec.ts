import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginRole } from './fixtures';

type Offer = {
  id: string;
  productName: string;
  warehouseName: string;
  priceKopecks: number;
  stock: number;
  active: boolean;
};

test('Настоящая покупка уменьшает запас во время правки поставщика, устаревший остаток не возвращается', async ({
  page,
  playwright,
}) => {
  await page.goto('/workspace');
  await loginRole(page, 'supplier');
  const offersResponse = await page.request.get('/api/v1/supplier/offers');
  expect(offersResponse.ok()).toBe(true);
  const offers: Offer[] = await offersResponse.json();
  const offer = offers.find((item) => item.active && item.stock >= 4);
  expect(offer).toBeTruthy();
  const row = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: offer!.productName, exact: true }) })
    .filter({ hasText: offer!.warehouseName });
  const dialog = page.getByRole('dialog', { name: 'Изменить предложение', exact: true });
  const buyer = await playwright.request.newContext({
    baseURL: 'http://localhost:3100',
    extraHTTPHeaders: { Origin: 'http://localhost:3100' },
  });
  const orders: string[] = [];
  const freshOffer = async (): Promise<Offer> => {
    const response = await page.request.get('/api/v1/supplier/offers');
    expect(response.ok()).toBe(true);
    return ((await response.json()) as Offer[]).find((item) => item.id === offer!.id)!;
  };
  const reserve = async () => {
    const response = await buyer.post('/api/v1/orders', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        address: 'Астрахань, ул. Савушкина, 6',
        items: [{ offerId: offer!.id, quantity: 1 }],
      },
    });
    expect(response.ok()).toBe(true);
    const order = await response.json();
    orders.push(order.id);
    return order;
  };
  try {
    const registered = await buyer.post('/api/v1/auth/register', {
      data: {
        name: 'Проверка остатка',
        email: `stock-${randomUUID()}@example.test`,
        password: 'TestPass2026!',
      },
    });
    expect(registered.ok()).toBe(true);
    await row.getByRole('button', { name: 'Изменить', exact: true }).click();
    const firstOrder = await reserve();
    const changedPrice = offer!.priceKopecks + 100;
    await dialog.getByLabel('Цена, ₽', { exact: true }).fill(String(changedPrice / 100));
    const priceResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/supplier/offers/${offer!.id}`,
    );
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const priceResponse = await priceResponsePromise;
    expect(priceResponse.ok()).toBe(true);
    expect(priceResponse.request().postDataJSON()).toEqual({ priceKopecks: changedPrice });
    await expect(dialog).toBeHidden();
    expect(await freshOffer()).toMatchObject({
      priceKopecks: changedPrice,
      stock: offer!.stock - 1,
    });
    const savedOrder = await buyer.get(`/api/v1/orders/${firstOrder.id}`);
    expect(savedOrder.ok()).toBe(true);
    expect((await savedOrder.json()).items[0].priceKopecks).toBe(offer!.priceKopecks);

    await row.getByRole('button', { name: 'Изменить', exact: true }).click();
    await expect(dialog.getByLabel('Остаток', { exact: true })).toHaveValue(
      String(offer!.stock - 1),
    );
    await reserve();
    const stockDraft = offer!.stock + 5;
    await dialog.getByLabel('Остаток', { exact: true }).fill(String(stockDraft));
    await dialog.getByLabel('Цена, ₽', { exact: true }).fill(String((changedPrice + 100) / 100));
    const conflictResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/supplier/offers/${offer!.id}`,
    );
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const conflictResponse = await conflictResponsePromise;
    expect(conflictResponse.status()).toBe(409);
    expect((await conflictResponse.json()).code).toBe('offer_stock_changed');
    expect(conflictResponse.request().postDataJSON()).toEqual({
      priceKopecks: changedPrice + 100,
      stock: stockDraft,
      expectedStock: offer!.stock - 1,
    });
    await expect(
      dialog.getByRole('heading', { name: 'Сохранённые значения', exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Остаток', { exact: true })).toHaveValue(String(stockDraft));
    expect(await freshOffer()).toMatchObject({
      priceKopecks: changedPrice,
      stock: offer!.stock - 2,
    });
    await dialog
      .getByRole('button', { name: 'Загрузить сохранённые значения', exact: true })
      .click();
    await expect(dialog.getByLabel('Остаток', { exact: true })).toHaveValue(
      String(offer!.stock - 2),
    );
    await expect(dialog.getByLabel('Цена, ₽', { exact: true })).toHaveValue(
      String(changedPrice / 100),
    );
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  } finally {
    // Неоплаченные тестовые заказы возвращают резерв; исходные данные восстанавливаем отдельно.
    for (const id of orders)
      expect((await buyer.post(`/api/v1/orders/${id}/cancel`)).ok()).toBe(true);
    const current = await freshOffer();
    const restored = await page.request.patch(`/api/v1/supplier/offers/${offer!.id}`, {
      headers: { Origin: 'http://localhost:3100' },
      data: {
        priceKopecks: offer!.priceKopecks,
        stock: offer!.stock,
        expectedStock: current.stock,
      },
    });
    expect(restored.ok()).toBe(true);
    await buyer.dispose();
  }
});
