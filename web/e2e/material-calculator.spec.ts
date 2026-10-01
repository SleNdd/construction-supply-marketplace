import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { loginBuyer, reply } from './fixtures';

const projectId = '77777777-7777-7777-7777-777777777777';
const materials = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Песчаник, коробка', unit: 'коробка', packaging: { kind: 'tiles', tileAreaM2: .36, tilesPerPack: 4 } },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Графит, коробка', unit: 'коробка', packaging: { kind: 'tiles', tileAreaM2: .18, tilesPerPack: 7 } },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Белая краска, 10 л', unit: 'ведро', packaging: { kind: 'paint', packSizeL: 10 } },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Смесь, 25 кг', unit: 'мешок', packaging: { kind: 'dry-mix', packSizeKg: 25 } },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Плитка без фасовки', unit: 'м²', packaging: null },
].map(product => ({ ...product, category: 'Материалы', slug: product.id, priceFromKopecks: 10000, offers: [] }));
function preparedResult(index: number) {
  const product = materials[index];
  const [packages, coverage, coverageUnit, calculatedConsumption, consumptionUnit] = index === 0 ? [19, 27.36, 'м²', 74, 'шт.'] : index === 1 ? [21, 26.46, 'м²', 147, 'шт.'] : index === 2 ? [2, 20, 'л', 15.12, 'л'] : [27, 675, 'кг', 660, 'кг'];
  return { productId: product.id, unit: product.unit, packaging: product.packaging, formula: 'Контрольный результат для проверки интерфейса', packages, coverage, coverageUnit, calculatedConsumption, consumptionUnit };
}
async function fixture(page: Page, preview?: (route: Route) => Promise<void>, add?: (route: Route) => Promise<void>, items: unknown[] = []) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'buyer', name: 'Покупатель', email: 'buyer@example.test', role: 'buyer' } });
    if (path === '/categories') return reply(route, []);
    if (path === '/geo/config') return reply(route, { mapKey: null, source: 'demo' });
    if (path === '/geo/route') return reply(route, { source: 'demo' });
    if (path === '/products') return reply(route, { items: materials, page: 1, total: materials.length });
    if (path.startsWith('/products/')) return reply(route, materials.find(product => product.id === path.split('/').at(-1)));
    if (path === `/projects/${projectId}`) return reply(route, { id: projectId, name: 'Проверка калькулятора', address: 'Астрахань, ул. Савушкина, 6', items });
    if (path === `/projects/${projectId}/items/from-calculation` && add) return add(route);
    if (path === '/calculators/material') {
      if (preview) return preview(route);
      return reply(route, preparedResult(materials.findIndex(product => product.id === route.request().postDataJSON().productId)));
    }
    throw new Error(`Неожиданный API в проверке калькулятора: ${path}`);
  });
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Калькулятор материалов', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Материал', exact: true }).locator('option')).toHaveCount(6);
}

for (const [index, kind, tab, expected] of [[0, 'tiles', 'Плитка', '19 коробок'], [2, 'paint', 'Краска', '2 ведра'], [3, 'dry-mix', 'Сухая смесь', '27 мешков']] as const) {
  test(`UI калькулятора с фикстурами: ${kind}, фасовка товара и закрытые исходные параметры`, async ({ page }) => {
    await fixture(page);
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.getByRole('combobox', { name: 'Материал', exact: true }).selectOption(materials[index].id);
    const posted = page.waitForRequest(request => request.url().endsWith('/calculators/material'));
    await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
    const body = (await posted).postDataJSON();
    expect(body.productId).toBe(materials[index].id);
    expect(body.kind).toBe(kind);
    expect(Object.keys(body.inputs).sort()).toEqual((kind === 'tiles' ? ['areaM2', 'wastePercent'] : kind === 'paint' ? ['areaM2', 'coats', 'rateLPerM2', 'wastePercent'] : ['areaM2', 'layerMm', 'rateKgPerM2Mm', 'wastePercent']).sort());
    await expect(page.getByRole('region', { name: 'Результат расчёта' })).toContainText(expected);
    await page.getByLabel(kind === 'tiles' ? 'Площадь облицовки' : kind === 'paint' ? 'Площадь окрашивания' : 'Площадь работ', { exact: true }).fill('25');
    await expect(page.getByRole('region', { name: 'Результат расчёта' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Материал', exact: true }).locator(`option[value="${materials[4].id}"]`)).toHaveJSProperty('disabled', true);
  });
}

test('UI калькулятора с фикстурами: смена товара отменяет запоздавший результат', async ({ page }) => {
  let held: Route | undefined;
  await fixture(page, async route => {
    if (route.request().postDataJSON().productId === materials[0].id) { held = route; return; }
    await reply(route, preparedResult(1));
  });
  const select = page.getByRole('combobox', { name: 'Материал', exact: true });
  await select.selectOption(materials[0].id);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await select.selectOption(materials[1].id);
  await expect(page.getByRole('region', { name: 'Результат расчёта' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результат расчёта' });
  await expect(result).toContainText('21 коробка');
  await reply(held!, preparedResult(0));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(result).toContainText('26,46 м²');
  await expect(result).not.toContainText('19 коробок');
});

test('UI калькулятора с фикстурами: повтор удалённой позиции и явный новый расчёт', async ({ page }) => {
  const keys: string[] = [];
  await fixture(page, undefined, async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length <= 2) return reply(route, { message: 'Позиция этого расчёта удалена; для нового добавления нужен новый ключ' }, 409);
    return reply(route, { item: { id: 'new-item', productId: materials[0].id, productName: materials[0].name, unit: 'коробка', quantity: 19, stageDate: null }, calculation: preparedResult(0) });
  });
  await page.getByRole('combobox', { name: 'Материал', exact: true }).selectOption(materials[0].id);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const calculator = page.getByRole('region', { name: 'Калькулятор материалов', exact: true });
  const add = page.getByRole('button', { name: 'Добавить расчёт в объект', exact: true });
  await add.click();
  await expect(calculator.getByRole('alert')).toContainText('Позиция этого расчёта удалена');
  await add.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(add).toBeEnabled();
  await page.getByRole('button', { name: 'Новый расчёт', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результат расчёта' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await add.click();
  await expect(calculator).toContainText('Материал добавлен в перечень объекта');
  expect(keys).toHaveLength(3);
  expect(keys[2]).not.toBe(keys[0]);
});

test('UI калькулятора с фикстурами: мобильный экран и обе темы', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await page.getByRole('combobox', { name: 'Материал', exact: true }).selectOption(materials[0].id);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результат расчёта' });
  await expect(result).toContainText('19 коробок');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of ['Материал', 'Площадь облицовки', 'Запас на подрезку', 'К этапу']) {
      const box = await page.getByLabel(control, { exact: true }).boundingBox();
      expect(box?.height, control).toBeGreaterThanOrEqual(44);
    }
  }
});

test('UI калькулятора с фикстурами: повтор со снимком ответа сохраняет изменённую потребность', async ({ page }) => {
  const existing = { id: 'same-item', productId: materials[0].id, productName: materials[0].name, unit: 'коробка', quantity: 99, stageDate: null };
  await fixture(page, undefined, route => reply(route, { item: { ...existing, quantity: 19 }, calculation: preparedResult(0) }), [existing]);
  await expect(page.locator('.needs-list .need-row')).toContainText('99 коробок');
  await page.getByRole('combobox', { name: 'Материал', exact: true }).selectOption(materials[0].id);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить расчёт в объект', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Результат расчёта' })).toContainText('Материал добавлен в перечень объекта');
  await expect(page.locator('.needs-list .need-row')).toHaveCount(1);
  await expect(page.locator('.needs-list .need-row')).toContainText('99 коробок');
});

test('Настоящий API и UI: расчёт коробок, потерянный ответ, один материал, заказ и отмена', async ({ page }) => {
  await page.goto('/projects');
  await loginBuyer(page);
  const created = await page.request.post('/api/v1/projects', { headers: { Origin: new URL(page.url()).origin }, data: { name: `E2E расчёт ${randomUUID()}`, address: 'Астрахань, ул. Савушкина, 6' } });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const detailsResponse = await page.request.get('/api/v1/products/tile-beige-box');
  expect(detailsResponse.ok()).toBe(true);
  const product = await detailsResponse.json();
  const beforeStocks = new Map<string, number>(product.offers.map((offer: { id: string; stock: number }) => [offer.id, offer.stock]));
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('combobox', { name: 'Материал', exact: true }).locator(`option[value="${product.id}"]`)).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Материал', exact: true }).selectOption(product.id);
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const result = page.getByRole('region', { name: 'Результат расчёта' });
  await expect(result).toContainText('19 коробок');
  await expect(result).toContainText('27,36 м²');
  await result.getByLabel('К этапу', { exact: true }).fill('2030-01-02');
  const path = `/api/v1/projects/${project.id}/items/from-calculation`;
  let firstKey: string | undefined;
  // Сервер выполнил запись, но клиент потерял ответ. Повтор идёт в настоящий API.
  await page.route(`**${path}`, async route => {
    firstKey = route.request().headers()['idempotency-key'];
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort('failed');
  }, { times: 1 });
  await result.getByRole('button', { name: 'Добавить расчёт в объект', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Калькулятор материалов', exact: true }).getByRole('alert')).toContainText(/fetch|запрос|Failed/i);
  const repeated = page.waitForResponse(response => new URL(response.url()).pathname === path);
  await result.getByRole('button', { name: 'Добавить расчёт в объект', exact: true }).click();
  const response = await repeated;
  expect(response.ok()).toBe(true);
  expect(response.request().headers()['idempotency-key']).toBe(firstKey);
  await expect(result).toContainText('Материал добавлен в перечень объекта');
  const stored = await (await page.request.get(`/api/v1/projects/${project.id}`)).json();
  expect(stored.items).toHaveLength(1);
  expect(stored.items[0]).toMatchObject({ productId: product.id, quantity: 19, unit: 'коробка', stageDate: '2030-01-02' });
  await expect(page.locator('.needs-list .need-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Добавить план в корзину' })).toBeEnabled();
  await page.getByRole('button', { name: 'Добавить план в корзину' }).click();
  await page.goto('/cart');
  await page.getByLabel('Адрес доставки', { exact: true }).fill(project.address);
  await page.getByRole('button', { name: 'Рассчитать доставку', exact: true }).click();
  await page.getByRole('link', { name: 'Оформить заказ', exact: true }).click();
  await page.getByRole('combobox').selectOption(project.id);
  const ordered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/orders' && response.request().method() === 'POST');
  let orderId: string | undefined;
  let cancelled = false;
  try {
    await expect(page.getByRole('button', { name: 'Подтвердить заказ', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
    const placed = await ordered;
    expect(placed.ok()).toBe(true);
    orderId = (await placed.json()).id;
    const order = await (await page.request.get(`/api/v1/orders/${orderId}`)).json();
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ quantity: 19, unit: 'коробка' });
    const fresh = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
    const offerId = order.items[0].offerId;
    expect(fresh.offers.find((offer: { id: string }) => offer.id === offerId).stock).toBe(beforeStocks.get(offerId)! - 19);
    await page.getByRole('button', { name: 'Отменить заказ', exact: true }).click();
    await expect(page.getByText('Отменён', { exact: true })).toBeVisible();
    cancelled = true;
    const restored = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
    expect(restored.offers.find((offer: { id: string }) => offer.id === offerId).stock).toBe(beforeStocks.get(offerId));
  } finally {
    if (orderId && !cancelled) expect((await page.request.post(`/api/v1/orders/${orderId}/cancel`, { headers: { Origin: new URL(page.url()).origin } })).ok()).toBe(true);
  }
});
