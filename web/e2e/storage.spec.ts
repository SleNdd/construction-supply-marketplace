import { expect, test, type Page } from '@playwright/test';
import type { CartItem, Product } from '../src/lib/api';

const ids = Array.from({ length: 6 }, (_, index) => `aaaaaaaa-0000-0000-0000-${String(index + 1).padStart(12, '0')}`);
const first: CartItem = { offerId: ids[0], productId: ids[1], productName: 'Материал из сохранённой корзины', supplierName: 'Демопоставщик', unit: 'шт.', quantity: 2, priceKopecks: 15000 };

async function damageStorage(page: Page, cart: string, compare: string) {
  await page.evaluate(({ cart, compare }) => {
    localStorage.setItem('objectmarket-cart', cart);
    localStorage.setItem('objectmarket-compare', compare);
  }, { cart, compare });
  await page.reload();
}

test('Повреждённый JSON и значения вместо массивов не ломают корзину и сравнение после перезагрузки', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/cart');
  for (const payload of ['{broken', '{}', 'null', '42', '"text"']) {
    await damageStorage(page, payload, payload);
    await expect(page.getByRole('link', { name: 'Корзина, товаров: 0', exact: true })).toBeVisible();
    await expect(page.locator('.cart-row')).toHaveCount(0);
    await page.goto('/compare');
    await expect(page.getByText('Пока нечего сравнивать', { exact: true })).toBeVisible();
    await page.goto('/cart');
  }
  expect(errors).toEqual([]);
});

test('Корзина сохраняет корректные строки среди повреждённых и не суммирует дубли предложения', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/cart');
  const second = { ...first, offerId: ids[2], productName: 'Второй сохранённый материал', quantity: 3 };
  const invalid = [null, 7, [], {},
    ...[0, -1, 1.5, 10001, '2', null].map(quantity => ({ ...first, offerId: ids[3], quantity })),
    ...[0, -1, 1.5, 2147483648, '15000', null].map(priceKopecks => ({ ...first, offerId: ids[3], priceKopecks })),
    ...['offerId', 'productId', 'productName', 'supplierName', 'unit'].map(field => ({ ...first, offerId: ids[3], [field]: '' }))];
  await damageStorage(page, JSON.stringify([...invalid, first, { ...first, offerId: first.offerId.toUpperCase(), quantity: 9999 }, second]), '[]');
  await expect(page.locator('.cart-row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Корзина, товаров: 5', exact: true })).toBeVisible();
  await expect(page.locator('.cart-row').first()).toContainText(first.productName);
  await expect(page.locator('.cart-row').last()).toContainText(second.productName);
  // Изменение сохраняет восстановленные строки; повреждённые соседи не возвращаются.
  await page.locator('.cart-row').first().getByRole('button', { name: 'Увеличить количество' }).click();
  await page.reload();
  await expect(page.locator('.cart-row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Корзина, товаров: 6', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart')!))).toEqual([{ ...first, quantity: 3 }, second]);
  expect(errors).toEqual([]);
});

test('Сравнение после внешнего повреждения содержит максимум четыре уникальных товара', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Подменены только ответы товаров; хранилище и интерфейс работают как обычно.
  await page.route('**/api/v1/products/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const product: Product = { id, name: `Сохранённый товар ${ids.indexOf(id) + 1}`, slug: id, category: 'Материалы', unit: 'шт.', priceFromKopecks: 15000, specs: {}, offers: [] };
    await route.fulfill({ json: product });
  });
  await page.goto('/compare');
  await damageStorage(page, '[]', JSON.stringify([null, {}, 17, '', 'not-an-id', ids[0], ids[0].toUpperCase(), ...ids.slice(1)]));
  const selected = page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /^Сравнение\s*4$/ });
  await expect(selected).toBeVisible();
  for (let index = 0; index < 4; index++) {
    await expect(page.getByRole('link', { name: `Сохранённый товар ${index + 1}`, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Сохранённый товар 5', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Сохранённый товар 6', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(selected).toBeVisible();
  expect(errors).toEqual([]);
});

test('Лимиты корзины запрещают добавление с сохранением уже выбранных позиций', async ({ page }) => {
  const product: Product = {
    id: first.productId, slug: 'storage-limit', name: first.productName, category: 'Материалы', unit: first.unit, priceFromKopecks: first.priceKopecks,
    offers: [{ id: first.offerId, supplierId: ids[3], supplierName: first.supplierName, warehouseId: ids[4], priceKopecks: first.priceKopecks,
      stock: 20000, deliveryDays: 1, earliestDeliveryDate: '2026-10-02', deliveryCostKopecks: 10000 }],
  };
  await page.route(`**/api/v1/products/${first.productId}`, route => route.fulfill({ json: product }));
  await page.goto(`/product/${first.productId}`);
  const atLimit = [{ ...first, quantity: 10000 }];
  await damageStorage(page, JSON.stringify(atLimit), '[]');
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('до 10 000 единиц одного предложения');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart')!))).toEqual(atLimit);
  await page.goto('/cart');
  await expect(page.locator('.cart-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Увеличить количество', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Уменьшить количество', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Увеличить количество', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Увеличить количество', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Увеличить количество', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Корзина, товаров: 10000', exact: true })).toBeVisible();

  const fullCart = Array.from({ length: 50 }, (_, index) => ({ ...first, quantity: 1,
    offerId: `bbbbbbbb-0000-0000-0000-${String(index + 1).padStart(12, '0')}` }));
  await page.goto(`/product/${first.productId}`);
  await damageStorage(page, JSON.stringify(fullCart), '[]');
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('до 50 разных предложений');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart')!))).toEqual(fullCart);
  await page.goto('/cart');
  await expect(page.locator('.cart-row')).toHaveCount(50);
});
