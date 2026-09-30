import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import type { Product } from '../src/lib/api';
import { reply } from './fixtures';

const productId = '11111111-1111-1111-1111-111111111111';
const secondId = '22222222-2222-2222-2222-222222222222';
const cheapUnit = '33333333-3333-3333-3333-333333333333';
const cheapDelivery = '44444444-4444-4444-4444-444444444444';
const product: Product = {
  id: productId, slug: 'test-material', name: 'Материал А', category: 'Материалы', unit: 'мешок', priceFromKopecks: 10000,
  specs: { 'Масса': '25 кг', 'Назначение': 'Внутренние работы' },
  offers: [
    { id: cheapUnit, supplierId: 'a', supplierName: 'Дешевле за мешок', warehouseId: 'wa', warehouseName: 'Склад на Савушкина', warehouseAddress: 'Астрахань, ул. Савушкина, 6', priceKopecks: 10000, stock: 20, deliveryDays: 2, earliestDeliveryDate: '2030-01-03', deliveryCostKopecks: 30000 },
    { id: cheapDelivery, supplierId: 'b', supplierName: 'Дешевле с доставкой', warehouseId: 'wb', warehouseName: 'Склад на Татищева', warehouseAddress: 'Астрахань, ул. Татищева, 18', priceKopecks: 20000, stock: 20, deliveryDays: 4, earliestDeliveryDate: '2030-01-05', deliveryCostKopecks: 1000 },
  ],
};
const second: Product = { ...product, id: secondId, name: 'Материал Б', offers: [{ ...product.offers![0], stock: 0 }] };

function quote(route: Route, warnings: string[] = []) {
  const { items } = route.request().postDataJSON();
  const offer = product.offers!.find(value => value.id === items[0].offerId)!;
  const materials = offer.priceKopecks * items[0].quantity;
  return {
    lines: [{ offerId: offer.id, quantity: items[0].quantity, priceKopecks: offer.priceKopecks, stock: offer.stock, earliestDeliveryDate: offer.earliestDeliveryDate }],
    itemsTotalKopecks: materials, deliveryTotalKopecks: offer.deliveryCostKopecks, totalKopecks: materials + offer.deliveryCostKopecks,
    unavailable: [], warnings, zoneAvailable: true,
  };
}

async function mockComparison(page: Page, options: {
  ids?: string[]; dark?: boolean; failSecond?: boolean; onQuote?: (route: Route) => Promise<void>;
} = {}) {
  let failed = false;
  await page.addInitScript(({ ids, dark }) => {
    localStorage.setItem('objectmarket-compare', JSON.stringify(ids));
    localStorage.setItem('objectmarket-theme', dark ? 'dark' : 'light');
  }, { ids: options.ids || [productId], dark: options.dark || false });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: null });
    if (path === '/categories') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === `/products/${productId}`) return reply(route, product);
    if (path === `/products/${secondId}`) {
      if (options.failSecond && !failed) { failed = true; return reply(route, { message: 'Временная ошибка загрузки' }, 503); }
      return reply(route, second);
    }
    if (path === '/quotes') return options.onQuote ? options.onQuote(route) : reply(route, quote(route));
    throw new Error(`Неожиданный запрос сравнения: ${path}`);
  });
  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: 'Сравнение материалов', exact: true })).toBeVisible();
}

test('Сравнение: стоимость доставки, количество и дата меняют исходный выбор предложения', async ({ page }) => {
  const requests: Array<{ items: Array<{ offerId: string; quantity: number }>; address: string; requestedDate?: string }> = [];
  await mockComparison(page, { onQuote: async route => { requests.push(route.request().postDataJSON()); await reply(route, quote(route)); } });
  const card = page.getByRole('article', { name: product.name, exact: true });
  const add = card.getByRole('button', { name: 'В корзину', exact: true });
  await expect(add).toBeDisabled();
  await page.getByLabel('Адрес доставки', { exact: true }).fill('Астрахань, ул. Савушкина, 6');
  await expect(add).toBeEnabled();
  await expect(card.getByLabel('Предложение', { exact: true })).toHaveValue(cheapDelivery);
  await expect(card).toContainText('Склад на Татищева');
  await expect(card).toContainText('Астрахань, ул. Татищева, 18');
  await expect(card).toContainText('05.01.2030');
  await expect(card.getByText('Итого за вариант').locator('..')).toContainText('210');
  await card.getByLabel('Количество', { exact: true }).fill('4');
  await expect(card.getByLabel('Предложение', { exact: true })).toHaveValue(cheapUnit);
  await expect(add).toBeEnabled();
  await expect(card.getByText('Итого за вариант').locator('..')).toContainText('700');
  await card.getByLabel('Количество', { exact: true }).fill('1');
  await expect(card.getByLabel('Предложение', { exact: true })).toHaveValue(cheapDelivery);
  await page.getByLabel('Желаемая дата', { exact: true }).fill('2030-01-04');
  await expect(card.getByLabel('Предложение', { exact: true })).toHaveValue(cheapUnit);
  await expect(add).toBeEnabled();
  expect(requests.at(-1)).toEqual({ items: [{ offerId: cheapUnit, quantity: 1 }], address: 'Астрахань, ул. Савушкина, 6', requestedDate: '2030-01-04' });
  await page.getByLabel('Желаемая дата', { exact: true }).fill('2030-01-02');
  await expect(add).toBeDisabled();
  await expect(card.getByText('Закупка недоступна', { exact: true })).toBeVisible();
});

test('Сравнение: частичная ошибка повторяется отдельно, недоступный материал остаётся видимым', async ({ page }) => {
  await mockComparison(page, { ids: [productId, secondId], failSecond: true });
  await page.getByLabel('Адрес доставки', { exact: true }).fill('Астрахань, ул. Савушкина, 6');
  const healthy = page.getByRole('article', { name: product.name, exact: true });
  await expect(healthy.getByRole('button', { name: 'В корзину', exact: true })).toBeEnabled();
  const failed = page.getByRole('article', { name: 'Материал 2', exact: true });
  await expect(failed.getByRole('alert')).toHaveText('Временная ошибка загрузки');
  await failed.getByRole('button', { name: 'Повторить загрузку' }).click();
  const unavailable = page.getByRole('article', { name: second.name, exact: true });
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toContainText('На складе 0, требуется 1');
  await expect(unavailable.getByRole('button', { name: 'В корзину', exact: true })).toBeDisabled();
  await expect(healthy.getByRole('button', { name: 'В корзину', exact: true })).toBeEnabled();
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('Сравнение: возврат количества требует нового расчёта, запоздавший ответ не меняет перенос', async ({ page }) => {
  let calls = 0;
  const pending: Route[] = [];
  const completed = new Set<Request>();
  page.on('requestfinished', request => completed.add(request));
  page.on('requestfailed', request => completed.add(request));
  await mockComparison(page, { onQuote: async route => {
    if (++calls === 1) await reply(route, quote(route, ['Начальная оценка']));
    else pending.push(route);
  } });
  await page.getByLabel('Адрес доставки', { exact: true }).fill('Астрахань, ул. Савушкина, 6');
  const card = page.getByRole('article', { name: product.name, exact: true });
  const add = card.getByRole('button', { name: 'В корзину', exact: true });
  const quantity = card.getByLabel('Количество', { exact: true });
  await expect(add).toBeEnabled();
  await quantity.fill('0');
  await expect(add).toBeDisabled();
  await quantity.fill('10001');
  await expect(add).toBeDisabled();
  await quantity.fill('2');
  await expect.poll(() => pending.length).toBe(1);
  await quantity.fill('1');
  await expect.poll(() => pending.length).toBe(2);
  await expect(add).toBeDisabled();
  await expect(card.getByText('Начальная оценка', { exact: true })).toHaveCount(0);
  await reply(pending[1], quote(pending[1], ['Текущая оценка']));
  await expect(add).toBeEnabled();
  await reply(pending[0], quote(pending[0], ['Запоздавшая оценка']));
  await expect.poll(() => completed.has(pending[0].request())).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(card.getByText('Текущая оценка', { exact: true })).toBeVisible();
  await expect(card.getByText('Запоздавшая оценка', { exact: true })).toHaveCount(0);
  await add.click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart') || '[]'))).toEqual([{
    offerId: cheapDelivery, quantity: 1, productId, productName: product.name, supplierName: 'Дешевле с доставкой', priceKopecks: 20000, unit: 'мешок',
  }]);
});

test('Сравнение на телефоне: карточки читаются в обеих темах и страница не выходит за экран', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockComparison(page, { ids: [productId, secondId], dark: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const first = page.getByRole('article', { name: product.name, exact: true });
  const other = page.getByRole('article', { name: second.name, exact: true });
  await expect(first).toBeVisible();
  await expect(other).toBeVisible();
  const a = await first.boundingBox();
  const b = await other.boundingBox();
  expect(b!.y).toBeGreaterThan(a!.y + a!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('button', { name: 'Светлая тема', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(first.getByRole('link', { name: product.name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const failure of [
  { kind: 'zone', name: 'адрес вне зоны', message: 'Адрес вне демонстрационной зоны' },
  { kind: 'date', name: 'срок изменился', message: 'Ближайшая дата изменилась' },
  { kind: 'stock', name: 'остаток изменился', message: 'На складе только 0' },
  { kind: 'request', name: 'расчёт недоступен', message: 'Не удалось рассчитать закупку' },
] as const) {
  test(`Сравнение: ${failure.name} запрещает корзину, обновление проверяет условия заново`, async ({ page }) => {
    let denied = true;
    await mockComparison(page, { onQuote: async route => {
      const current = quote(route);
      if (!denied) return reply(route, current);
      if (failure.kind === 'request') return reply(route, { message: 'Сервис расчёта временно недоступен' }, 503);
      if (failure.kind === 'zone') return reply(route, { ...current, zoneAvailable: false });
      if (failure.kind === 'date') return reply(route, { ...current, lines: [{ ...current.lines[0], earliestDeliveryDate: '2030-01-07' }] });
      return reply(route, { ...current, lines: [{ ...current.lines[0], stock: 0 }], unavailable: [{ offerId: current.lines[0].offerId, reason: 'На складе только 0' }] });
    } });
    await page.getByLabel('Желаемая дата', { exact: true }).fill('2030-01-06');
    await page.getByLabel('Адрес доставки', { exact: true }).fill('Астрахань, ул. Савушкина, 6');
    const card = page.getByRole('article', { name: product.name, exact: true });
    await expect(card.getByRole('alert')).toContainText(failure.message);
    await expect(card.getByRole('button', { name: 'В корзину', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('objectmarket-cart'))).toBeNull();
    denied = false;
    await card.getByRole('button', { name: 'Обновить условия', exact: true }).click();
    await expect(card.getByRole('button', { name: 'В корзину', exact: true })).toBeEnabled();
    await expect(card.getByRole('alert')).toHaveCount(0);
    await expect(card.getByLabel('Количество', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('Желаемая дата', { exact: true })).toHaveValue('2030-01-06');
  });
}
