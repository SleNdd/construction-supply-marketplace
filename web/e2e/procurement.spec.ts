import { test, expect, type Page, type Route, type Request } from '@playwright/test';
import { reply } from './fixtures';

const productId = '11111111-1111-1111-1111-111111111111';
const projectId = '22222222-2222-2222-2222-222222222222';
const firstOffer = '33333333-3333-3333-3333-333333333333';
const secondOffer = '44444444-4444-4444-4444-444444444444';
const offers = [
  { id: firstOffer, supplierName: 'Поставка А', supplierId: 'a', warehouseId: 'wa', stock: 10, priceKopecks: 10000, deliveryCostKopecks: 1000, deliveryDays: 2, earliestDeliveryDate: '2026-10-03' },
  { id: secondOffer, supplierName: 'Поставка Б', supplierId: 'b', warehouseId: 'wb', stock: 10, priceKopecks: 20000, deliveryCostKopecks: 1000, deliveryDays: 2, earliestDeliveryDate: '2026-10-03' },
];

function quote(offerId = firstOffer, earliestDeliveryDate = '2026-10-03', warnings: string[] = []) {
  const offer = offers.find(value => value.id === offerId)!;
  return { lines: [{ offerId, earliestDeliveryDate }], itemsTotalKopecks: offer.priceKopecks, deliveryTotalKopecks: 1000, totalKopecks: offer.priceKopecks + 1000, unavailable: [], warnings, pricingNote: 'Доставка один раз на поставщика', zoneAvailable: true };
}

async function mockPlan(page: Page, stageDate: () => string, onQuote: (route: Route) => Promise<void>, options: { quantity?: number; duplicateNeed?: boolean } = {}) {
  let quantity = options.quantity ?? 1;
  let editedStage: string | undefined;
  let address = 'Астрахань, ул. Савушкина, 6';
  const need = () => ({ id: 'need', productId, productName: 'Материал для плана', unit: 'мешок', quantity, stageDate: editedStage ?? stageDate() });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'buyer', name: 'Покупатель', role: 'buyer', email: 'buyer@example.test' } });
    if (path === '/categories') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === `/products/${productId}`) return reply(route, { id: productId, name: 'Материал для плана', category: 'Смеси', unit: 'мешок', offers });
    if (path === `/projects/${projectId}`) {
      if (route.request().method() === 'PATCH') {
        address = route.request().postDataJSON().address;
        return reply(route, { id: projectId, name: 'Объект проверки', address, stages: [] });
      }
      return reply(route, { id: projectId, name: 'Объект проверки', address, items: [need(), ...(options.duplicateNeed ? [{ ...need(), id: 'need-two' }] : [])] });
    }
    if (path === `/projects/${projectId}/items/need` && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      quantity = body.quantity;
      editedStage = body.stageDate;
      return reply(route, need());
    }
    if (path === '/geo/config') return reply(route, { mapKey: null, source: 'demo' });
    if (path === '/geo/route') return reply(route, { source: 'demo' });
    if (path === '/quotes') return onQuote(route);
    throw new Error(`Неожиданный запрос в проверке плана: ${path}`);
  });
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Объект проверки', exact: true })).toBeVisible();
}

test('UI плана с фикстурами: дата сервера важнее даты и часового пояса браузера', async ({ page }) => {
  await page.clock.setFixedTime('2026-09-30T20:01:00Z');
  let stage = '2026-10-02';
  let calculations = 0;
  await mockPlan(page, () => stage, async route => {
    calculations++;
    await reply(route, quote());
  });
  const plan = page.getByRole('region', { name: 'Предложения для объекта' });
  const add = page.getByRole('button', { name: 'Добавить план в корзину' });
  await expect(page.getByText('Предложения с нужным остатком не успевают к дате этапа.', { exact: false })).toBeVisible();
  await expect(add).toBeDisabled();
  expect(calculations).toBe(0);
  stage = '2026-10-03';
  await page.reload();
  await expect(add).toBeEnabled();
  await expect(plan).toContainText('Не раньше 03.10.2026');
  expect(calculations).toBe(1);
});

test('UI плана с фикстурами: смена и возврат предложения требуют нового расчёта', async ({ page }) => {
  let firstCalls = 0;
  let pendingSecond: Route | undefined;
  let pendingReturn: Route | undefined;
  const completed = new Set<Request>();
  page.on('requestfinished', request => completed.add(request));
  page.on('requestfailed', request => completed.add(request));
  await mockPlan(page, () => '2026-10-03', async route => {
    const offerId = route.request().postDataJSON().items[0].offerId;
    if (offerId === secondOffer) pendingSecond = route;
    else if (++firstCalls === 1) await reply(route, quote(firstOffer, '2026-10-03', ['Первая оценка']));
    else pendingReturn = route;
  });
  const add = page.getByRole('button', { name: 'Добавить план в корзину' });
  const select = page.getByRole('combobox', { name: 'Поставщик и предложение' });
  await expect(add).toBeEnabled();
  await select.selectOption(secondOffer);
  await expect(add).toBeDisabled();
  await expect(page.getByText('Первая оценка')).toHaveCount(0);
  await expect.poll(() => Boolean(pendingSecond)).toBe(true);
  await select.selectOption(firstOffer);
  await expect(add).toBeDisabled();
  await expect.poll(() => Boolean(pendingReturn)).toBe(true);
  await reply(pendingReturn!, quote(firstOffer, '2026-10-03', ['Актуальный расчёт']));
  await expect(add).toBeEnabled();
  await reply(pendingSecond!, quote(secondOffer, '2026-10-03', ['Устаревший расчёт']));
  await expect.poll(() => completed.has(pendingSecond!.request())).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(select).toHaveValue(firstOffer);
  await expect(page.getByText('Актуальный расчёт')).toBeVisible();
  await expect(page.getByText('Устаревший расчёт')).toHaveCount(0);
  await expect(add).toBeEnabled();
});

test('UI плана с фикстурами: изменившийся срок в расчёте запрещает перенос в корзину', async ({ page }) => {
  await mockPlan(page, () => '2026-10-03', route => reply(route, quote(firstOffer, '2026-10-04')));
  await expect(page.getByRole('main').getByRole('alert')).toContainText('срок предложения изменился');
  await expect(page.getByRole('button', { name: 'Добавить план в корзину' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('objectmarket-cart'))).toBeNull();
});

for (const change of ['количество', 'дату этапа', 'адрес'] as const) {
  test(`UI плана с фикстурами: изменение ${change} блокирует корзину до нового расчёта и отклоняет старый ответ`, async ({ page }) => {
    const pending: Route[] = [];
    let calls = 0;
    const completed = new Set<Request>();
    page.on('requestfinished', request => completed.add(request));
    page.on('requestfailed', request => completed.add(request));
    await mockPlan(page, () => '2026-10-03', async route => {
      if (++calls === 1) await reply(route, quote(firstOffer, '2026-10-03', ['Исходный расчёт']));
      else pending.push(route);
    });
    const plan = page.getByRole('region', { name: 'Предложения для объекта' });
    const add = page.getByRole('button', { name: 'Добавить план в корзину' });
    await expect(add).toBeEnabled();
    await page.getByRole('button', { name: 'Обновить предложения' }).click();
    await expect.poll(() => pending.length).toBe(1);
    if (change === 'адрес') {
      await page.getByRole('button', { name: 'Изменить объект', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Изменить объект', exact: true });
      await editor.getByLabel('Адрес', { exact: true }).fill('Астрахань, ул. Татищева, 18');
      await editor.getByRole('button', { name: 'Сохранить изменения' }).click();
      await expect(editor).toBeHidden();
      await expect(page.locator('.page-heading p')).toHaveText('Астрахань, ул. Татищева, 18');
    } else {
      await page.getByRole('button', { name: 'Изменить Материал для плана', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Изменить материал', exact: true });
      await editor.getByLabel(change === 'количество' ? 'Количество' : 'К этапу', { exact: true }).fill(change === 'количество' ? '2' : '2026-10-04');
      await editor.getByRole('button', { name: 'Сохранить изменения' }).click();
      await expect(editor).toBeHidden();
    }
    await expect.poll(() => pending.length).toBe(2);
    await expect(add).toBeDisabled();
    await expect(page.getByText('Исходный расчёт', { exact: true })).toHaveCount(0);
    const currentBody = pending[1].request().postDataJSON();
    expect(currentBody.items).toEqual([{ offerId: firstOffer, quantity: change === 'количество' ? 2 : 1 }]);
    expect(currentBody.address).toBe(change === 'адрес' ? 'Астрахань, ул. Татищева, 18' : 'Астрахань, ул. Савушкина, 6');
    if (change === 'дату этапа') await expect(plan).toContainText('к 04.10.2026');
    await reply(pending[0], quote(firstOffer, '2026-10-03', ['Устаревший расчёт']));
    await expect.poll(() => completed.has(pending[0].request())).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByText('Устаревший расчёт', { exact: true })).toHaveCount(0);
    await expect(add).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('objectmarket-cart'))).toBeNull();
    const current = quote(firstOffer, '2026-10-03', ['Актуальный расчёт']);
    const materials = offers[0].priceKopecks * currentBody.items[0].quantity;
    await reply(pending[1], { ...current, itemsTotalKopecks: materials, totalKopecks: materials + current.deliveryTotalKopecks });
    await expect(page.getByText('Актуальный расчёт', { exact: true })).toBeVisible();
    await expect(add).toBeEnabled();
    await add.click();
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart') || '[]'));
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ offerId: firstOffer, quantity: change === 'количество' ? 2 : 1 });
    const checkout = await page.evaluate(() => JSON.parse(sessionStorage.getItem('objectmarket-project-checkout') || 'null'));
    expect(checkout.address).toBe(currentBody.address);
  });
}

test('UI плана с фикстурами: две потребности превышают общий остаток одного предложения', async ({ page }) => {
  let requestedItems: unknown;
  await mockPlan(page, () => '2026-10-03', async route => {
    requestedItems = route.request().postDataJSON().items;
    await reply(route, {
      ...quote(),
      itemsTotalKopecks: 120000, totalKopecks: 121000,
      unavailable: [{ offerId: firstOffer, reason: 'Для двух потребностей требуется 12 мешков, доступно 10.' }],
    });
  }, { quantity: 6, duplicateNeed: true });
  const plan = page.getByRole('region', { name: 'Предложения для объекта' });
  await expect(plan.getByRole('combobox', { name: 'Поставщик и предложение' })).toHaveCount(2);
  await expect(plan.getByRole('alert')).toContainText('требуется 12 мешков, доступно 10');
  expect(requestedItems).toEqual([{ offerId: firstOffer, quantity: 6 }, { offerId: firstOffer, quantity: 6 }]);
  await expect(page.getByRole('button', { name: 'Добавить план в корзину' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('objectmarket-cart'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('objectmarket-project-checkout'))).toBeNull();
});


test('UI плана с фикстурами: превышение лимита корзины не переносит часть плана', async ({ page }) => {
  const cart = Array.from({ length: 50 }, (_, index) => ({
    offerId: `cccccccc-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    productId, productName: 'Уже выбранный материал', supplierName: 'Поставка А', quantity: 1, priceKopecks: 10000, unit: 'мешок',
  }));
  await page.addInitScript(items => localStorage.setItem('objectmarket-cart', JSON.stringify(items)), cart);
  await mockPlan(page, () => '2026-10-03', async route => reply(route, quote()), { duplicateNeed: true });
  const add = page.getByRole('button', { name: 'Добавить план в корзину' });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole('region', { name: 'Предложения для объекта' }).getByRole('alert')).toContainText('План не добавлен');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart')!))).toEqual(cart);
  expect(await page.evaluate(() => sessionStorage.getItem('objectmarket-project-checkout'))).toBeNull();
});


test('UI плана с фикстурами: суммарный лимит уже выбранного предложения сохраняет корзину', async ({ page }) => {
  const cart = [{ offerId: firstOffer, productId, productName: 'Материал для плана', supplierName: 'Поставка А', quantity: 9999, priceKopecks: 10000, unit: 'мешок' }];
  await page.addInitScript(items => localStorage.setItem('objectmarket-cart', JSON.stringify(items)), cart);
  await mockPlan(page, () => '2026-10-03', async route => reply(route, quote()), { duplicateNeed: true });
  const add = page.getByRole('button', { name: 'Добавить план в корзину' });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole('region', { name: 'Предложения для объекта' }).getByRole('alert')).toContainText('План не добавлен');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart')!))).toEqual(cart);
  expect(await page.evaluate(() => sessionStorage.getItem('objectmarket-project-checkout'))).toBeNull();
});
