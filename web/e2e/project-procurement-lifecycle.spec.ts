import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type { DemoRole } from './fixtures';

type Offer = { id: string; supplierId: string; supplierName: string; priceKopecks: number; stock: number; deliveryCostKopecks: number };
type Material = { id: string; name: string; unit: string; offers: Offer[] };
type Selection = { material: Material; offer: Offer; quantity: number };
type Delivery = { id: string; supplierId: string; status: string; driverId: string | null; scheduledDate: string | null; deliveryCostKopecks: number };
type Order = {
  id: string; projectId: string; address: string; requestedDate: string; status: string;
  itemsTotalKopecks: number; deliveryTotalKopecks: number; totalKopecks: number;
  items: Array<{ id: string; offerId: string; supplierId: string; productName: string; unit: string; quantity: number; priceKopecks: number }>;
  deliveries: Delivery[]; paymentMode: string;
};
type Trip = { id: string; orderId: string; address: string; status: string; scheduledDate: string; items: Array<{ id: string; productName: string; quantity: number; unit: string }> };
const stageDate = '2032-11-10';

async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.ok(), `GET ${path}: ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}

function mutation(page: Page, path: string, method = 'POST') {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method);
}

async function screen(page: Page, name: string, info?: TestInfo) {
  expect(await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth })), `${name}: горизонтальное переполнение`).toEqual({ width: (await page.viewportSize())!.width, scroll: (await page.viewportSize())!.width });
  if (info) {
    const original = await page.evaluate(() => ({ left: window.scrollX, top: window.scrollY }));
    const scrollTo = async (position: { left: number; top: number }) => {
      await page.evaluate(async point => {
        window.scrollTo({ ...point, behavior: 'instant' });
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }, position);
      await expect.poll(() => page.evaluate(() => ({ left: window.scrollX, top: window.scrollY }))).toEqual(position);
    };
    try {
      await scrollTo({ left: 0, top: 0 });
      await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    } finally {
      await scrollTo(original);
    }
  }
}

async function closeMenu(page: Page) {
  const close = page.getByRole('button', { name: 'Закрыть меню', exact: true });
  if (await close.isVisible()) {
    await close.click();
    await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
}

async function loginRole(page: Page, role: DemoRole) {
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Вход', exact: true });
  await dialog.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await dialog.getByLabel('Пароль').fill('Demo2026!');
  const loggingIn = mutation(page, '/auth/login');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  const response = await loggingIn;
  expect(response.ok()).toBe(true);
  expect((await response.json()).user).toMatchObject({ role, email: `${role}@example.test` });
  await expect(dialog).toBeHidden();
  expect((await get<{ user: { role: string; email: string } }>(page, '/auth/me')).user).toMatchObject({ role, email: `${role}@example.test` });
  const open = page.getByRole('button', { name: 'Открыть меню', exact: true });
  if (await open.isVisible()) {
    await open.click();
    await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true }).getByRole('link', { name: 'Рабочий кабинет', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
    await closeMenu(page);
  } else {
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  }
}

async function switchRole(page: Page, role: DemoRole) {
  const logout = page.getByRole('button', { name: 'Выйти', exact: true });
  if (!await logout.isVisible()) {
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  }
  await expect(logout).toBeVisible();
  const loggingOut = mutation(page, '/auth/logout');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  expect((await loggingOut).ok()).toBe(true);
  await expect(page).toHaveURL('/');
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  await closeMenu(page);
  await loginRole(page, role);
  await page.goto('/workspace');
  const names = { buyer: 'покупатель', dispatcher: 'диспетчер', driver: 'водитель', supplier: 'поставщик', admin: 'администратор' };
  await expect(page.getByRole('main')).toContainText(`Роль: ${names[role]}.`);
}

function checkOrder(order: Order, selections: Selection[], projectId: string, address: string) {
  const itemsTotalKopecks = selections.reduce((sum, row) => sum + row.offer.priceKopecks * row.quantity, 0);
  const deliveryTotalKopecks = selections.reduce((sum, row) => sum + row.offer.deliveryCostKopecks, 0);
  expect(order).toMatchObject({ projectId, address, requestedDate: stageDate, itemsTotalKopecks, deliveryTotalKopecks, totalKopecks: itemsTotalKopecks + deliveryTotalKopecks });
  expect(order.items).toHaveLength(2);
  expect(order.deliveries).toHaveLength(2);
  expect(new Set(order.deliveries.map(row => row.supplierId)).size).toBe(2);
  for (const { material, offer, quantity } of selections) {
    expect(order.items.find(row => row.offerId === offer.id)).toMatchObject({ supplierId: offer.supplierId, productName: material.name, unit: material.unit, quantity, priceKopecks: offer.priceKopecks });
    expect(order.deliveries.filter(row => row.supplierId === offer.supplierId)).toHaveLength(1);
    expect(order.deliveries.find(row => row.supplierId === offer.supplierId)).toMatchObject({ deliveryCostKopecks: offer.deliveryCostKopecks });
  }
}

for (const theme of ['light', 'dark'] as const) for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1440, height: 900 }]) {
  test(`T15: закупка объекта до двух доставок, ${theme}, ${viewport.width}×${viewport.height}`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    expect(new URL(baseURL!).port, 'Только изолированный frontend').toBe('3100');
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(value => localStorage.setItem('objectmarket-theme', value), theme);
    await page.goto('/catalog');
    await loginRole(page, 'buyer');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await screen(page, 'Каталог');

    // Исходные данные читаем; объект, ведомость и заказ создаёт пользователь.
    const catalogue = await get<{ items: Array<{ id: string }>; total: number }>(page, '/products?inStock=true&limit=100');
    const materials: Material[] = [];
    for (const product of catalogue.items) materials.push(await get<Material>(page, `/products/${product.id}`));
    const selections: Selection[] = [];
    for (const material of materials) {
      const offer = material.offers.find(row => row.stock >= 2 && !selections.some(chosen => chosen.offer.supplierId === row.supplierId));
      if (offer) selections.push({ material, offer, quantity: selections.length + 1 });
      if (selections.length === 2) break;
    }
    expect(selections, 'Seed должен содержать два разных материала у двух разных поставщиков с остатком ≥ 2').toHaveLength(2);
    const projectName = `Закупка для отделки · ${randomUUID().slice(0, 8)}`;
    const address = 'Астрахань, ул. Савушкина, 6';
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Новый объект', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый объект', exact: true });
    await dialog.getByLabel('Название', { exact: true }).fill(projectName);
    await dialog.getByLabel('Адрес', { exact: true }).fill(address);
    const creating = mutation(page, '/projects');
    await dialog.getByRole('button', { name: 'Создать объект', exact: true }).click();
    const createdProject = await creating;
    expect(createdProject.ok()).toBe(true);
    expect(createdProject.request().postDataJSON()).toMatchObject({ name: projectName, address });
    const projectId: string = (await createdProject.json()).id;
    await expect(dialog).toBeHidden();
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: projectName, exact: true }) }).click();
    await expect(page).toHaveURL(`/projects/${projectId}`);
    await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible();

    const csv = `productId,quantity,stageDate\n${selections.map(row => `${row.material.id},${row.quantity},${stageDate}`).join('\n')}`;
    await page.getByLabel('Выбрать файл CSV / XLSX').setInputFiles({ name: 't15-needs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    const preview = page.getByRole('list', { name: 'Предпросмотр ведомости' });
    await expect(preview.getByRole('listitem')).toHaveCount(2);
    for (const row of selections) await expect(preview).toContainText(row.material.name);
    await expect(page.getByText('Допустимых: 2. С ошибками: 0. Добавлено: 0.', { exact: true })).toBeVisible();
    await screen(page, 'Ведомость — предпросмотр', testInfo);
    const importing = selections.map(row => page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/projects/${projectId}/items` && response.request().method() === 'POST' && response.request().postDataJSON().productId === row.material.id));
    await page.getByRole('button', { name: /Добавить допустимые/ }).click();
    const importedResponses = await Promise.all(importing);
    for (const [index, response] of importedResponses.entries()) {
      expect(response.ok()).toBe(true);
      const row = selections[index];
      const expected = { productId: row.material.id, quantity: row.quantity, stageDate };
      expect(response.request().postDataJSON()).toEqual(expected);
      expect(await response.json()).toMatchObject(expected);
    }
    await expect(page.getByText('Допустимых: 0. С ошибками: 0. Добавлено: 2.', { exact: true })).toBeVisible();
    const saved = await get<{ name: string; address: string; items: Array<{ productId: string; quantity: number; stageDate: string }> }>(page, `/projects/${projectId}`);
    expect(saved).toMatchObject({ name: projectName, address });
    expect(saved.items).toHaveLength(2);
    for (const row of selections) expect(saved.items.find(item => item.productId === row.material.id)).toMatchObject({ quantity: row.quantity, stageDate });
    await expect(page.locator('.needs-list .need-row')).toHaveCount(2);
    const plan = page.getByRole('region', { name: 'Предложения для объекта', exact: true });
    await expect(plan.getByRole('combobox', { name: 'Этап закупки', exact: true })).toHaveValue(stageDate);
    await expect(plan.locator('.plan-offer-row')).toHaveCount(2);
    for (const row of selections) await plan.locator('.plan-offer-row').filter({ hasText: row.material.name }).getByRole('combobox', { name: 'Поставщик и предложение', exact: true }).selectOption(row.offer.id);
    const transfer = plan.getByRole('button', { name: 'Добавить план в корзину', exact: true });
    await expect(transfer).toBeEnabled();
    await screen(page, 'Ведомость — выбранные предложения', testInfo);
    await transfer.click();
    await expect(plan.getByRole('status')).toContainText('Выбранный этап добавлен');
    await plan.getByRole('link', { name: 'Открыть корзину' }).click();
    await expect(page.locator('.cart-list')).toContainText(selections[0].material.name);
    await expect(page.locator('.cart-list')).toContainText(selections[1].material.name);
    await page.getByLabel('Адрес доставки', { exact: true }).fill(address);
    const estimating = mutation(page, '/quotes');
    await page.getByRole('button', { name: 'Рассчитать доставку', exact: true }).click();
    const estimate = await estimating;
    expect(estimate.ok()).toBe(true);
    const estimateBody = estimate.request().postDataJSON();
    expect(estimateBody.address).toBe(address);
    expect(estimateBody.items).toHaveLength(2);
    for (const row of selections) expect(estimateBody.items).toContainEqual({ offerId: row.offer.id, quantity: row.quantity });
    const quote = await estimate.json();
    const itemsTotal = selections.reduce((sum, row) => sum + row.offer.priceKopecks * row.quantity, 0);
    const deliveryTotal = selections.reduce((sum, row) => sum + row.offer.deliveryCostKopecks, 0);
    expect(quote).toMatchObject({ itemsTotalKopecks: itemsTotal, deliveryTotalKopecks: deliveryTotal, totalKopecks: itemsTotal + deliveryTotal, unavailable: [], zoneAvailable: true });
    await screen(page, 'Корзина');
    await page.getByRole('link', { name: 'Оформить заказ', exact: true }).click();
    await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue(address);
    await expect(page.getByLabel('Желаемая дата', { exact: true })).toHaveValue(stageDate);
    await expect(page.getByRole('combobox')).toHaveValue(projectId);
    await expect(page.getByRole('button', { name: 'Подтвердить заказ', exact: true })).toBeEnabled();
    await screen(page, 'Оформление', testInfo);
    const ordering = mutation(page, '/orders');
    await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
    const orderResponse = await ordering;
    expect(orderResponse.ok()).toBe(true);
    const body = orderResponse.request().postDataJSON();
    expect(body).toMatchObject({ projectId, requestedDate: stageDate, address });
    expect(body.items).toHaveLength(2);
    for (const row of selections) expect(body.items).toContainEqual({ offerId: row.offer.id, quantity: row.quantity });
    const orderId: string = (await orderResponse.json()).id;
    await expect(page).toHaveURL(`/orders/${orderId}`);
    await expect(page.locator('.order-detail-head').getByText('Ожидает оплаты', { exact: true })).toBeVisible();
    const reserved = await get<Order>(page, `/orders/${orderId}`);
    checkOrder(reserved, selections, projectId, address);
    expect(reserved.status).toBe('awaiting_payment');
    for (const row of selections) {
      const material = await get<Material>(page, `/products/${row.material.id}`);
      expect(material.offers.find(offer => offer.id === row.offer.id)!.stock).toBe(row.offer.stock - row.quantity);
    }
    const paying = mutation(page, `/orders/${orderId}/demo-payment`);
    await page.getByRole('button', { name: 'Подтвердить тестовую оплату', exact: true }).click();
    const payment = await paying;
    expect(payment.ok()).toBe(true);
    const paid: Order = await payment.json();
    expect(paid).toMatchObject({ status: 'paid', paymentMode: 'demo' });
    checkOrder(paid, selections, projectId, address);
    expect((await get<Order>(page, `/orders/${orderId}`)).status).toBe('paid');
    await screen(page, 'Оплаченный заказ');

    await switchRole(page, 'dispatcher');
    let driverId = '';
    for (const delivery of paid.deliveries) {
      await page.getByRole('button', { name: new RegExp(`ПОСТАВКА #${delivery.id.slice(0, 8).toUpperCase()}`) }).click();
      const card = page.getByRole('region', { name: 'Выбранная поставка', exact: true });
      await expect(card).toContainText(address);
      await card.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption({ label: 'Водитель Демо' });
      await card.getByLabel('Дата рейса', { exact: true }).fill(stageDate);
      const assigning = mutation(page, `/dispatch/deliveries/${delivery.id}`, 'PATCH');
      await card.getByRole('button', { name: 'Назначить', exact: true }).click();
      const assignedResponse = await assigning;
      expect(assignedResponse.ok()).toBe(true);
      const assigned = await assignedResponse.json();
      driverId = driverId || assigned.driverId;
      expect(assignedResponse.request().postDataJSON()).toEqual({ driverId, scheduledDate: stageDate });
      expect(assigned).toMatchObject({ id: delivery.id, orderId, driverId, scheduledDate: stageDate, status: 'assigned' });
      await expect(card.getByText('Назначен', { exact: true })).toBeVisible();
      await screen(page, `Диспетчер — ${delivery.id}`, testInfo);
    }
    const dispatched = await get<Array<Delivery & { orderId: string }>>(page, '/dispatch/deliveries');
    expect(dispatched.filter(row => row.orderId === orderId)).toHaveLength(2);
    for (const delivery of paid.deliveries) expect(dispatched.find(row => row.id === delivery.id)).toMatchObject({ driverId, scheduledDate: stageDate, status: 'assigned', supplierId: delivery.supplierId });

    await switchRole(page, 'driver');
    expect((await get<{ user: { id: string } }>(page, '/auth/me')).user.id).toBe(driverId);
    const events: Array<{ deliveryId: string; status: string }> = [];
    for (const [index, delivery] of paid.deliveries.entries()) {
      const trips = await get<Trip[]>(page, '/driver/deliveries');
      const trip = trips.find(row => row.id === delivery.id)!;
      expect(trip).toMatchObject({ orderId, address, status: 'assigned', scheduledDate: stageDate });
      const item = paid.items.find(row => row.supplierId === delivery.supplierId)!;
      expect(trip.items).toEqual([{ id: item.id, productName: item.productName, quantity: item.quantity, unit: item.unit }]);
      await page.getByRole('button', { name: new RegExp(`РЕЙС #${delivery.id.slice(0, 8).toUpperCase()}`) }).click();
      const card = page.getByRole('region', { name: 'Выбранный рейс', exact: true });
      await expect(card.getByRole('list', { name: 'Материалы поставки', exact: true }).getByRole('listitem')).toHaveCount(1);
      await expect(card).toContainText(item.productName);
      await screen(page, 'Водитель — груз');
      for (const step of [{ button: 'Материалы загружены', status: 'picked_up' }, { button: 'Начать рейс', status: 'in_transit' }, { button: 'Доставка завершена', status: 'delivered' }]) {
        const advancing = mutation(page, `/driver/deliveries/${delivery.id}/events`);
        await card.getByRole('button', { name: step.button, exact: true }).click();
        const response = await advancing;
        expect(response.ok()).toBe(true);
        expect(response.request().postDataJSON()).toEqual({ status: step.status });
        expect(await response.json()).toEqual({ id: delivery.id, status: step.status, trackingMode: 'demo' });
        expect((await get<Trip[]>(page, '/driver/deliveries')).find(row => row.id === delivery.id)).toMatchObject({ status: step.status, scheduledDate: stageDate });
        events.push({ deliveryId: delivery.id, status: step.status });
      }
      await switchRole(page, 'buyer');
      await page.goto(`/orders/${orderId}`);
      const current = await get<Order>(page, `/orders/${orderId}`);
      expect(current.status).toBe(index === 0 ? 'in_progress' : 'delivered');
      expect(current.deliveries.filter(row => row.status === 'delivered')).toHaveLength(index + 1);
      if (index === 0) {
        expect(current.deliveries.find(row => row.id !== delivery.id)).toMatchObject({ status: 'assigned' });
        await expect(page.locator('.order-detail-head').getByText('В работе', { exact: true })).toBeVisible();
        await screen(page, 'Покупатель — первая поставка завершена');
        await switchRole(page, 'driver');
      }
    }
    await testInfo.attach('POST событий рейсов', { body: JSON.stringify(events, null, 2), contentType: 'application/json' });
    const finalOrder = await get<Order>(page, `/orders/${orderId}`);
    checkOrder(finalOrder, selections, projectId, address);
    expect(finalOrder.status).toBe('delivered');
    for (const delivery of finalOrder.deliveries) expect(delivery).toMatchObject({ status: 'delivered', driverId, scheduledDate: stageDate });
    const stocks: Array<{ productId: string; offerId: string; quantity: number; initialStock: number; finalStock: number }> = [];
    for (const row of selections) {
      const material = await get<Material>(page, `/products/${row.material.id}`);
      const finalStock = material.offers.find(offer => offer.id === row.offer.id)!.stock;
      expect(finalStock).toBe(row.offer.stock - row.quantity);
      for (const original of row.material.offers) expect(material.offers.find(offer => offer.id === original.id)!.stock).toBe(original.stock - (original.id === row.offer.id ? row.quantity : 0));
      stocks.push({ productId: row.material.id, offerId: row.offer.id, quantity: row.quantity, initialStock: row.offer.stock, finalStock });
    }
    await testInfo.attach('T15 UUID и остатки', { body: JSON.stringify({ projectId, orderId, deliveryIds: paid.deliveries.map(row => row.id), driverId, stocks, events }, null, 2), contentType: 'application/json' });
    await expect(page.locator('.order-detail-head').getByText('Доставлен', { exact: true })).toBeVisible();
    await expect(page.getByText('Тестовая оплата подтверждена', { exact: true })).toBeVisible();
    await expect(page.locator('.order-detail')).toContainText(address);
    await screen(page, 'Покупатель — обе поставки завершены', testInfo);
  });
}
