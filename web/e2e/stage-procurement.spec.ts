import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Route, type Request } from '@playwright/test';
import { cartItem, loginBuyer, mockCheckout, reply, validQuote } from './fixtures';

const projectId = '22222222-2222-2222-2222-222222222222';
const productId = '11111111-1111-1111-1111-111111111111';
const offerId = '33333333-3333-3333-3333-333333333333';
const address = 'Астрахань, ул. Савушкина, 6';
type Need = { id: string; productId: string; productName: string; quantity: number; stageDate: string | null };
const initialNeeds = (): Need[] => [
  { id: 'later', productId, productName: 'Поздний этап', quantity: 7, stageDate: '2030-11-20' },
  { id: 'undated', productId, productName: 'Материал без даты', quantity: 3, stageDate: null },
  { id: 'early', productId, productName: 'Первый этап', quantity: 2, stageDate: '2030-11-10' },
];
const quoted = (warnings: string[] = []) => ({ ...validQuote, itemsTotalKopecks: 10000, lines: [{ offerId, earliestDeliveryDate: '2026-10-03' }], pricingNote: 'Доставка один раз на поставщика', warnings });

async function mockStages(page: Page, onQuote: (route: Route) => Promise<void> = route => reply(route, quoted()), needs = initialNeeds()) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'buyer', name: 'Покупатель', role: 'buyer', email: 'buyer@example.test' } });
    if (path === '/categories' || path === '/projects') return reply(route, path === '/projects' ? [{ id: projectId, name: 'Этапы объекта' }] : []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === `/products/${productId}`) return reply(route, { id: productId, name: 'Материал этапа', category: 'Смеси', unit: 'мешок', offers: [{ id: offerId, supplierName: 'Поставка А', stock: 10000, priceKopecks: 10000, deliveryCostKopecks: 1000, deliveryDays: 2, earliestDeliveryDate: '2026-10-03' }] });
    if (path === `/projects/${projectId}`) return reply(route, { id: projectId, name: 'Этапы объекта', address, items: needs });
    if (path.startsWith(`/projects/${projectId}/items/`)) {
      const index = needs.findIndex(item => item.id === path.split('/').at(-1));
      if (route.request().method() === 'DELETE') { needs.splice(index, 1); return route.fulfill({ status: 204 }); }
      needs[index] = { ...needs[index], ...route.request().postDataJSON() };
      return reply(route, needs[index]);
    }
    if (path === '/geo/config' || path === '/geo/route') return reply(route, { source: 'demo', mapKey: null });
    if (path === '/geo/suggest') return reply(route, { source: 'demo', items: [] });
    if (path === '/quotes') return onQuote(route);
    if (path.startsWith('/products/bbbbbbbb-')) return route.fallback();
    throw new Error(`Unexpected stage API: ${route.request().method()} ${path}`);
  });
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Этапы объекта', exact: true })).toBeVisible();
}
const plan = (page: Page) => page.getByRole('region', { name: 'Предложения для объекта' });
const stage = (page: Page) => plan(page).getByRole('combobox', { name: 'Этап закупки' });
const add = (page: Page) => plan(page).getByRole('button', { name: /Добавить (этап|план) в корзину/ });
const stored = (page: Page) => page.evaluate(() => ({ cart: JSON.parse(localStorage.getItem('objectmarket-cart') || '[]'), context: JSON.parse(sessionStorage.getItem('objectmarket-project-checkout') || 'null') }));

for (const width of [390, 1024, 1440]) {
  test(`UI этапов: три группы, календарная дата и отдельная корзина, ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('objectmarket-theme', 'dark'));
    const bodies: Array<{ items: unknown; requestedDate?: string }> = [];
    await mockStages(page, async route => { bodies.push(route.request().postDataJSON()); await reply(route, quoted()); });
    await expect(stage(page)).toHaveValue('2030-11-10');
    await expect(stage(page).locator('option')).toHaveCount(3);
    await expect(plan(page).locator('.plan-offer-row')).toHaveCount(1);
    await expect(plan(page)).toContainText('Первый этап');
    await expect(plan(page)).not.toContainText('Поздний этап');
    await expect(add(page)).toBeEnabled();
    expect(bodies.at(-1)).toMatchObject({ items: [{ offerId, quantity: 2 }], requestedDate: '2030-11-10' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await stage(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await add(page).click();
    await expect(plan(page).getByRole('status')).toContainText('Выбранный этап добавлен');
    await expect(add(page)).toBeDisabled();
    const result = await stored(page);
    expect(result.cart).toHaveLength(1);
    expect(result.cart[0]).toMatchObject({ offerId, quantity: 2 });
    expect(result.context).toEqual({ projectId, address, items: [{ offerId, quantity: 2 }], requestedDate: '2030-11-10' });
    // Повторное событие даже при программном вызове не удваивает группу.
    await add(page).evaluate(button => (button as HTMLButtonElement).click());
    expect(await stored(page)).toEqual(result);
    await page.goto('/checkout');
    await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue(address);
    await expect(page.getByLabel('Желаемая дата', { exact: true })).toHaveValue('2030-11-10');
    await expect(page.getByRole('combobox')).toHaveValue(projectId);
    await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeEnabled();
  });
}

test('UI этапов: выбор группы без даты переносит только её и оставляет дату checkout пустой', async ({ page }) => {
  let body: { requestedDate?: string; items: unknown } | undefined;
  await mockStages(page, async route => { body = route.request().postDataJSON(); await reply(route, quoted()); });
  await stage(page).selectOption('');
  await expect(add(page)).toBeEnabled();
  expect(body!.requestedDate).toBeUndefined();
  expect(body!.items).toEqual([{ offerId, quantity: 3 }]);
  await expect(plan(page)).toContainText('Материал без даты');
  await expect(plan(page)).not.toContainText('Первый этап');
  await add(page).click();
  expect((await stored(page)).context.requestedDate).toBeNull();
  await page.goto('/checkout');
  await expect(page.getByLabel('Желаемая дата', { exact: true })).toHaveValue('');
  await page.getByLabel('Желаемая дата', { exact: true }).fill('2030-12-01');
  await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeEnabled();
  expect(body!.requestedDate).toBe('2030-12-01');
});

test('UI этапов: непустая корзина и прежний checkout context не изменяются', async ({ page }) => {
  const context = { projectId, address: 'Прежний адрес', items: [{ offerId: cartItem.offerId, quantity: 1 }], requestedDate: '2030-12-01' };
  await page.addInitScript(({ item, context }) => { localStorage.setItem('objectmarket-cart', JSON.stringify([item])); sessionStorage.setItem('objectmarket-project-checkout', JSON.stringify(context)); }, { item: cartItem, context });
  await mockStages(page);
  await expect(add(page)).toBeEnabled();
  await add(page).click();
  await expect(plan(page).getByRole('alert')).toContainText('нужна пустая корзина');
  await expect(plan(page).getByRole('link', { name: 'Открыть корзину' })).toHaveAttribute('href', '/cart');
  expect(await stored(page)).toEqual({ cart: [cartItem], context });
});

test('UI этапов: смена группы отменяет старый расчёт', async ({ page }) => {
  let held: Route | undefined;
  const completed = new Set<Request>();
  page.on('requestfinished', request => completed.add(request));
  page.on('requestfailed', request => completed.add(request));
  await mockStages(page, async route => { if (route.request().postDataJSON().requestedDate === '2030-11-10') held = route; else await reply(route, quoted(['Текущий этап'])); });
  await expect.poll(() => Boolean(held)).toBe(true);
  await stage(page).selectOption('2030-11-20');
  await expect(add(page)).toBeEnabled();
  await reply(held!, quoted(['Устаревший этап']));
  await expect.poll(() => completed.has(held!.request())).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(plan(page)).toContainText('Текущий этап');
  await expect(plan(page)).not.toContainText('Устаревший этап');
  await add(page).click();
  expect((await stored(page)).cart[0].quantity).toBe(7);
});

for (const action of ['remove', 'change-date'] as const) {
  test(`UI этапов: исчезнувшая выбранная группа переходит к существующей (${action})`, async ({ page }) => {
    const bodies: Array<{ requestedDate?: string }> = [];
    await mockStages(page, async route => { bodies.push(route.request().postDataJSON()); await reply(route, quoted()); });
    await stage(page).selectOption('2030-11-20');
    await expect(add(page)).toBeEnabled();
    if (action === 'remove') {
      await page.getByRole('button', { name: 'Удалить Поздний этап', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Удалить материал', exact: true });
      await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Изменить Поздний этап', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Изменить материал', exact: true });
      await dialog.getByLabel('К этапу', { exact: true }).fill('2030-11-01');
      await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
    }
    const expectedDate = action === 'remove' ? '2030-11-10' : '2030-11-01';
    await expect(stage(page)).toHaveValue(expectedDate);
    await expect(add(page)).toBeEnabled();
    expect(bodies.at(-1)!.requestedDate).toBe(expectedDate);
    await add(page).click();
    expect((await stored(page)).context.requestedDate).toBe(expectedDate);
  });
}

for (const damaged of ['json', 'date', 'uuid', 'items', 'duplicate', 'mismatch'] as const) {
  test(`UI checkout: повреждённый или чужой контекст не применяет адрес, дату и объект (${damaged})`, async ({ page }) => {
    const source = { projectId, address, items: [{ offerId: cartItem.offerId, quantity: cartItem.quantity }], requestedDate: '2030-11-10' };
    const payload = damaged === 'json' ? '{broken' : JSON.stringify({ ...source,
      ...(damaged === 'date' ? { requestedDate: '2030-02-30' } : {}),
      ...(damaged === 'uuid' ? { projectId: 'wrong' } : {}),
      ...(damaged === 'items' ? { items: null } : {}),
      ...(damaged === 'duplicate' ? { items: [...source.items, ...source.items] } : {}),
      ...(damaged === 'mismatch' ? { items: [{ offerId: cartItem.offerId, quantity: 2 }] } : {}),
    });
    await page.addInitScript(payload => sessionStorage.setItem('objectmarket-project-checkout', payload), payload);
    await mockCheckout(page, async (route, path) => { if (path === '/projects') { await reply(route, [{ id: projectId, name: 'Контекст' }]); return true; } if (path === '/quotes') { await reply(route, validQuote); return true; } return false; });
    await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue('');
    await expect(page.getByLabel('Желаемая дата', { exact: true })).toHaveValue('');
    await expect(page.getByRole('combobox')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeDisabled();
  });
}

test('UI checkout: дата из контекста редактируется, старый ответ не разрешает подтверждение', async ({ page }) => {
  await page.addInitScript(source => sessionStorage.setItem('objectmarket-project-checkout', JSON.stringify(source)), { projectId, address, items: [{ offerId: cartItem.offerId, quantity: 1 }], requestedDate: '2030-11-10' });
  const pending: Route[] = [];
  const completed = new Set<Request>();
  page.on('requestfailed', request => completed.add(request));
  page.on('requestfinished', request => completed.add(request));
  await mockCheckout(page, async (route, path) => {
    if (path === '/projects') { await reply(route, [{ id: projectId, name: 'Объект' }]); return true; }
    if (path === '/quotes') { pending.push(route); return true; }
    return false;
  });
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0].request().postDataJSON().requestedDate).toBe('2030-11-10');
  await page.getByLabel('Желаемая дата', { exact: true }).fill('2030-11-12');
  await expect.poll(() => pending.length).toBe(2);
  const confirm = page.getByRole('button', { name: 'Подтвердить заказ' });
  await reply(pending[0], { ...validQuote, warnings: ['Старая дата'] });
  await expect.poll(() => completed.has(pending[0].request())).toBe(true);
  await expect(confirm).toBeDisabled();
  await expect(page.getByText('Старая дата')).toHaveCount(0);
  expect(pending[1].request().postDataJSON().requestedDate).toBe('2030-11-12');
  await reply(pending[1], validQuote);
  await expect(confirm).toBeEnabled();
});

test('Настоящий API: отдельный этап, редактируемая дата заказа, резерв и отмена', async ({ page }) => {
  await page.goto('/projects');
  await loginBuyer(page);
  const headers = { Origin: new URL(page.url()).origin };
  const created = await page.request.post('/api/v1/projects', { headers, data: { name: `E2E этапы ${randomUUID()}`, address } });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const productsResponse = await page.request.get('/api/v1/products?inStock=true&limit=100');
  expect(productsResponse.ok()).toBe(true);
  const product = (await productsResponse.json()).items[0];
  const details = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
  for (const [quantity, stageDate] of [[2, '2030-11-10'], [3, '2030-11-20'], [1, null]] as const) {
    const added = await page.request.post(`/api/v1/projects/${project.id}/items`, { headers, data: { productId: product.id, quantity, stageDate } });
    expect(added.ok()).toBe(true);
  }
  await page.goto(`/projects/${project.id}`);
  await expect(add(page)).toBeEnabled();
  const chosenOffer = await plan(page).getByRole('combobox', { name: 'Поставщик и предложение' }).inputValue();
  const initialStock = details.offers.find((item: { id: string }) => item.id === chosenOffer).stock;
  await add(page).click();
  expect((await stored(page)).cart).toEqual([expect.objectContaining({ offerId: chosenOffer, quantity: 2 })]);
  await page.goto('/checkout');
  await expect(page.getByLabel('Желаемая дата', { exact: true })).toHaveValue('2030-11-10');
  await expect(page.getByRole('combobox')).toHaveValue(project.id);
  const nextQuote = page.waitForResponse(response => response.url().endsWith('/quotes') && response.request().postDataJSON().requestedDate === '2030-11-12');
  await page.getByLabel('Желаемая дата', { exact: true }).fill('2030-11-12');
  expect((await nextQuote).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Подтвердить заказ' })).toBeEnabled();
  let orderId: string | undefined;
  let cancelled = false;
  try {
    const ordered = page.waitForResponse(response => response.url().endsWith('/orders') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
    const response = await ordered;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({ projectId: project.id, address, requestedDate: '2030-11-12', items: [{ offerId: chosenOffer, quantity: 2 }] });
    orderId = (await response.json()).id;
    await expect(page).toHaveURL(`/orders/${orderId}`);
    const order = await (await page.request.get(`/api/v1/orders/${orderId}`)).json();
    expect(order.projectId).toBe(project.id);
    expect(order.requestedDate).toBe('2030-11-12');
    expect(order.items).toEqual([expect.objectContaining({ offerId: chosenOffer, quantity: 2 })]);
    const reserved = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
    expect(reserved.offers.find((item: { id: string }) => item.id === chosenOffer).stock).toBe(initialStock - 2);
    await page.getByRole('button', { name: 'Отменить заказ', exact: true }).click();
    await expect(page.getByText('Отменён', { exact: true })).toBeVisible();
    cancelled = true;
    const restored = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
    expect(restored.offers.find((item: { id: string }) => item.id === chosenOffer).stock).toBe(initialStock);
  } finally {
    if (orderId && !cancelled) expect((await page.request.post(`/api/v1/orders/${orderId}/cancel`, { headers })).ok()).toBe(true);
  }
});


test('UI этапов: preflight суммарных 10 000 единиц предшествует проверке непустой корзины', async ({ page }) => {
  const oldContext = '{"old":"preserve"}';
  await page.addInitScript(({ item, oldContext }) => { localStorage.setItem('objectmarket-cart', JSON.stringify([item])); sessionStorage.setItem('objectmarket-project-checkout', oldContext); }, { item: cartItem, oldContext });
  const needs = [1, 2].map(index => ({ id: `large-${index}`, productId, productName: 'Большая потребность', quantity: 6000, stageDate: '2030-11-10' }));
  await mockStages(page, route => reply(route, quoted()), needs);
  await expect(add(page)).toBeEnabled();
  await add(page).click();
  await expect(plan(page).getByRole('alert')).toContainText('до 10 000 единиц');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('objectmarket-cart')!))).toEqual([cartItem]);
  expect(await page.evaluate(() => sessionStorage.getItem('objectmarket-project-checkout'))).toBe(oldContext);
});

test('UI этапов: preflight 51 предложения не переносит частичную корзину', async ({ page }) => {
  const needs = Array.from({ length: 51 }, (_, index) => ({ id: `many-${index}`, productId: `bbbbbbbb-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, productName: `Потребность ${index}`, quantity: 1, stageDate: '2030-11-10' }));
  await page.route('**/api/v1/products/bbbbbbbb-*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    await reply(route, { id, name: 'Материал', unit: 'мешок', offers: [{ id, supplierName: 'Поставка', stock: 10, priceKopecks: 10000, deliveryCostKopecks: 1000, deliveryDays: 2, earliestDeliveryDate: '2026-10-03' }] });
  });
  // Более поздний общий route передаёт только эти детали отдельной фикстуре.
  await mockStages(page, route => reply(route, { ...quoted(), lines: needs.map(item => ({ offerId: item.productId, earliestDeliveryDate: '2026-10-03' })) }), needs);
  await expect(add(page)).toBeEnabled();
  await add(page).click();
  await expect(plan(page).getByRole('alert')).toContainText('до 50 предложений');
  expect(await stored(page)).toEqual({ cart: [], context: null });
});

test('UI этапов: отказ записи корзины восстанавливает прежний контекст без частичного переноса', async ({ page }) => {
  const oldContext = '{"old":"preserve"}';
  await page.addInitScript(oldContext => {
    sessionStorage.setItem('objectmarket-project-checkout', oldContext);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (this === localStorage && key === 'objectmarket-cart') throw new DOMException('Test quota', 'QuotaExceededError');
      original.call(this, key, value);
    };
  }, oldContext);
  await mockStages(page);
  await expect(add(page)).toBeEnabled();
  await add(page).click();
  await expect(plan(page).getByRole('alert')).toContainText('Не удалось сохранить закупку');
  expect(await page.evaluate(() => localStorage.getItem('objectmarket-cart'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('objectmarket-project-checkout'))).toBe(oldContext);
});


test('UI этапов: изменение другой группы сохраняет выбор, удаление выбранной даёт fallback', async ({ page }) => {
  const bodies: Array<{ requestedDate?: string; items: unknown }> = [];
  await mockStages(page, async route => { bodies.push(route.request().postDataJSON()); await reply(route, quoted()); });
  await stage(page).selectOption('2030-11-20');
  await expect(add(page)).toBeEnabled();
  const selectedElement = await stage(page).elementHandle();
  await page.getByRole('button', { name: 'Изменить Первый этап', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Изменить материал', exact: true });
  await edit.getByLabel('Количество', { exact: true }).fill('5');
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator('.needs-list .need-row').filter({ hasText: 'Первый этап' })).toContainText('5');
  await expect(stage(page)).toHaveValue('2030-11-20');
  expect(await selectedElement!.evaluate(element => element.isConnected)).toBe(true);
  await expect(plan(page).locator('.plan-offer-row')).toHaveCount(1);
  await expect(plan(page)).toContainText('Поздний этап');
  await expect(plan(page)).not.toContainText('Первый этап');
  expect(bodies.at(-1)).toMatchObject({ requestedDate: '2030-11-20', items: [{ offerId, quantity: 7 }] });
  await page.getByRole('button', { name: 'Удалить Поздний этап', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Удалить материал', exact: true });
  await remove.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(remove).toBeHidden();
  await expect(stage(page)).toHaveValue('2030-11-10');
  await expect(add(page)).toBeEnabled();
  await expect(plan(page).locator('.plan-offer-row')).toHaveCount(1);
  await expect(plan(page)).toContainText('Первый этап');
  await expect(plan(page)).not.toContainText('Поздний этап');
  expect(bodies.at(-1)).toMatchObject({ requestedDate: '2030-11-10', items: [{ offerId, quantity: 5 }] });
});


test('UI этапов: отказ записи контекста сохраняет пустую корзину и прежний контекст', async ({ page }) => {
  const oldContext = '{"old":"preserve"}';
  await page.addInitScript(oldContext => {
    sessionStorage.setItem('objectmarket-project-checkout', oldContext);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (this === sessionStorage && key === 'objectmarket-project-checkout') throw new DOMException('Test quota', 'QuotaExceededError');
      original.call(this, key, value);
    };
  }, oldContext);
  await mockStages(page);
  await expect(add(page)).toBeEnabled();
  await add(page).click();
  await expect(plan(page).getByRole('alert')).toContainText('Не удалось сохранить закупку');
  expect(await page.evaluate(() => localStorage.getItem('objectmarket-cart'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('objectmarket-project-checkout'))).toBe(oldContext);
});

test('UI объекта: новый id скрывает прежний объект и отменяет старый ответ refresh', async ({ page }) => {
  await mockStages(page);
  await expect(add(page)).toBeEnabled();
  let oldRefresh: Route | undefined;
  let nextProject: Route | undefined;
  const completed = new Set<Request>();
  page.on('requestfailed', request => completed.add(request));
  page.on('requestfinished', request => completed.add(request));
  const nextId = '55555555-5555-5555-5555-555555555555';
  await page.route(`**/api/v1/projects/${projectId}`, route => { oldRefresh = route; });
  await page.route(`**/api/v1/projects/${nextId}`, route => { nextProject = route; });
  await page.getByRole('button', { name: 'Изменить Первый этап', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Изменить материал', exact: true });
  await edit.getByLabel('Количество', { exact: true }).fill('5');
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect.poll(() => Boolean(oldRefresh)).toBe(true);
  await expect(add(page)).toBeDisabled();
  await page.evaluate(nextId => window.history.pushState(null, '', `/projects/${nextId}`), nextId);
  await expect.poll(() => Boolean(nextProject)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Этапы объекта', exact: true })).toHaveCount(0);
  await expect(page.getByText('Загружаем объект…', { exact: true })).toBeVisible();
  await reply(nextProject!, { id: nextId, name: 'Новый объект', address, items: [] });
  await expect(page.getByRole('heading', { name: 'Новый объект', exact: true })).toBeVisible();
  await reply(oldRefresh!, { id: projectId, name: 'Устаревший объект', address, items: initialNeeds() });
  await expect.poll(() => completed.has(oldRefresh!.request())).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'Устаревший объект', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Новый объект', exact: true })).toBeVisible();
});
