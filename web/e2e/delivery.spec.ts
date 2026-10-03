import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { loginRole, type DemoRole } from './fixtures';

type Offer = { id: string; supplierName: string; priceKopecks: number; stock: number; deliveryCostKopecks: number };

test.use({ timezoneId: 'America/Los_Angeles' });

async function switchRole(page: Page, role: DemoRole) {
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/');
  await loginRole(page, role);
  await page.goto('/workspace');
  const roleName = { buyer: 'покупатель', supplier: 'поставщик', dispatcher: 'диспетчер', driver: 'водитель', admin: 'администратор' }[role];
  await expect(page.getByRole('main')).toContainText(`Роль: ${roleName}.`);
}

test('Настоящая доставка: демооплата, назначение водителя, загрузка, рейс и завершённый заказ покупателя', async ({ page }) => {
  // Уникальные заказ и адрес остаются в отдельной временной БД; оплаченный резерв не отменяем.
  const address = `Астрахань, ул. Савушкина, 6, E2E ${randomUUID()}`;
  const quantity = 2;
  await page.goto('/catalog');
  await loginRole(page, 'buyer');
  const productsResponse = await page.request.get('/api/v1/products?inStock=true&limit=100');
  expect(productsResponse.ok()).toBe(true);
  const products: Array<{ id: string; name: string }> = (await productsResponse.json()).items;
  expect(products.length).toBeGreaterThan(0);
  const product = products[0];
  const detailsResponse = await page.request.get(`/api/v1/products/${product.id}`);
  expect(detailsResponse.ok()).toBe(true);
  const details: { offers: Offer[] } = await detailsResponse.json();
  const offer = details.offers.find(item => item.stock >= quantity);
  expect(offer, 'В демоданных нужно предложение с остатком не менее двух единиц').toBeTruthy();
  const expectedItemsTotal = offer!.priceKopecks * quantity;
  const expectedDeliveryTotal = offer!.deliveryCostKopecks;
  const expectedTotal = expectedItemsTotal + expectedDeliveryTotal;
  const expectedFormattedTotal = new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', minimumFractionDigits: expectedTotal % 100 ? 2 : 0, maximumFractionDigits: expectedTotal % 100 ? 2 : 0,
  }).format(expectedTotal / 100);

  await page.goto(`/product/${product.id}`);
  const offerRow = page.locator('.offer-row').filter({ hasText: offer!.supplierName });
  await offerRow.getByRole('spinbutton', { name: 'Количество', exact: true }).fill(String(quantity));
  await offerRow.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByRole('link', { name: `Корзина, товаров: ${quantity}`, exact: true }).click();
  await expect(page.locator('.cart-list')).toContainText(product.name);
  await page.getByLabel('Адрес доставки', { exact: true }).fill(address);
  await page.getByRole('button', { name: 'Рассчитать доставку', exact: true }).click();
  await page.getByRole('link', { name: 'Оформить заказ', exact: true }).click();
  await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue(address);
  await expect(page.getByRole('button', { name: 'Подтвердить заказ', exact: true })).toBeEnabled();
  const createdResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/orders' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.ok()).toBe(true);
  const orderId: string = (await createdResponse.json()).id;
  await expect(page).toHaveURL(`/orders/${orderId}`);
  await expect(page.getByText('Ожидает оплаты', { exact: true })).toBeVisible();
  const paymentResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/orders/${orderId}/demo-payment` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Подтвердить тестовую оплату', exact: true }).click();
  const paymentResponse = await paymentResponsePromise;
  expect(paymentResponse.ok()).toBe(true);
  const paidOrder = await paymentResponse.json();
  expect(paidOrder.status).toBe('paid');
  expect(paidOrder.paymentMode).toBe('demo');
  expect(paidOrder.itemsTotalKopecks).toBe(expectedItemsTotal);
  expect(paidOrder.deliveryTotalKopecks).toBe(expectedDeliveryTotal);
  expect(paidOrder.totalKopecks).toBe(expectedTotal);
  expect(paidOrder.deliveries).toHaveLength(1);
  const deliveryId: string = paidOrder.deliveries[0].id;
  await expect(page.getByText('Оплачен', { exact: true })).toBeVisible();
  await expect(page.locator('.order-detail-head').getByRole('heading')).toHaveText(expectedFormattedTotal);

  await switchRole(page, 'dispatcher');
  const dispatchCard = page.locator('.delivery-card').filter({ hasText: address });
  await expect(dispatchCard).toHaveCount(1);
  await expect(dispatchCard).toContainText(`ПОСТАВКА #${deliveryId.slice(0, 8).toUpperCase()}`);
  await expect(dispatchCard.getByText('Ожидает', { exact: true })).toBeVisible();
  await dispatchCard.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption({ label: 'Водитель Демо' });
  const scheduledDate = '2030-10-15';
  await dispatchCard.getByLabel('Дата рейса', { exact: true }).fill(scheduledDate);
  const assignedResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/dispatch/deliveries/${deliveryId}` && response.request().method() === 'PATCH');
  await dispatchCard.getByRole('button', { name: 'Назначить', exact: true }).click();
  const assignedResponse = await assignedResponsePromise;
  expect(assignedResponse.ok()).toBe(true);
  const assigned = await assignedResponse.json();
  expect(assigned.status).toBe('assigned');
  expect(assigned.scheduledDate).toBe(scheduledDate);
  await expect(dispatchCard.getByText('Назначен', { exact: true })).toBeVisible();
  await expect(dispatchCard.getByLabel('Дата рейса', { exact: true })).toHaveValue(scheduledDate);
  await expect(dispatchCard.locator('.delivery-card-meta')).toContainText('15.10.2030');

  await switchRole(page, 'driver');
  const meResponse = await page.request.get('/api/v1/auth/me');
  expect(meResponse.ok()).toBe(true);
  expect((await meResponse.json()).user.id).toBe(assigned.driverId);
  const driverResponse = await page.request.get('/api/v1/driver/deliveries');
  expect(driverResponse.ok()).toBe(true);
  const driverDeliveries: Array<{ id: string; scheduledDate: string; items: Array<{ id: string; productName: string; quantity: number; unit: string }> }> = await driverResponse.json();
  const assignedTrip = driverDeliveries.find(item => item.id === deliveryId);
  expect(assignedTrip?.scheduledDate).toBe(scheduledDate);
  expect(assignedTrip?.items).toEqual(paidOrder.items.map((item: { id: string; productName: string; quantity: number; unit: string }) => ({ id: item.id, productName: item.productName, quantity: item.quantity, unit: item.unit })));
  expect(Object.keys(assignedTrip!.items[0]).sort()).toEqual(['id', 'productName', 'quantity', 'unit']);
  await page.getByRole('button', { name: new RegExp(`РЕЙС #${deliveryId.slice(0, 8).toUpperCase()}`) }).click();
  const driverCard = page.getByRole('region', { name: 'Выбранный рейс', exact: true });
  await expect(driverCard).toHaveCount(1);
  await expect(driverCard).toContainText(address);
  await expect(driverCard).toContainText(`РЕЙС #${deliveryId.slice(0, 8).toUpperCase()}`);
  await expect(driverCard.getByText('Назначен', { exact: true })).toBeVisible();
  await expect(driverCard).toContainText('15.10.2030');
  const cargo = driverCard.getByRole('list', { name: 'Материалы поставки', exact: true });
  await expect(cargo.getByRole('listitem')).toHaveCount(1);
  await expect(cargo.getByRole('listitem')).toHaveText(`${product.name}${quantity.toLocaleString('ru-RU')}${paidOrder.items[0].unit}`);
  await expect(cargo.getByText(paidOrder.items[0].unit, { exact: true })).toBeVisible();
  for (const step of [
    { button: 'Материалы загружены', status: 'picked_up', label: 'Загружен' },
    { button: 'Начать рейс', status: 'in_transit', label: 'В пути' },
    { button: 'Доставка завершена', status: 'delivered', label: 'Доставлен' },
  ]) {
    const eventResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/driver/deliveries/${deliveryId}/events` && response.request().method() === 'POST');
    await driverCard.getByRole('button', { name: step.button, exact: true }).click();
    const response = await eventResponsePromise;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().status).toBe(step.status);
    expect((await response.json()).status).toBe(step.status);
    if (step.status === 'delivered') await page.getByRole('button', { name: 'Открыть завершённый рейс' }).click();
    await expect(driverCard.getByText(step.label, { exact: true })).toBeVisible();
  }
  await expect(driverCard.getByRole('button')).toHaveCount(0);

  await switchRole(page, 'buyer');
  await page.goto(`/orders/${orderId}`);
  await expect(page.locator('.order-detail-head').getByText('Доставлен', { exact: true })).toBeVisible();
  await expect(page.locator('.order-detail-head').getByRole('heading')).toHaveText(expectedFormattedTotal);
  await expect(page.getByText('Тестовая оплата подтверждена', { exact: true })).toBeVisible();
  await expect(page.locator('.order-detail')).toContainText(address);
  const finalResponse = await page.request.get(`/api/v1/orders/${orderId}`);
  expect(finalResponse.ok()).toBe(true);
  const finalOrder = await finalResponse.json();
  expect(finalOrder.status).toBe('delivered');
  expect(finalOrder.itemsTotalKopecks).toBe(expectedItemsTotal);
  expect(finalOrder.deliveryTotalKopecks).toBe(expectedDeliveryTotal);
  expect(finalOrder.totalKopecks).toBe(expectedTotal);
  expect(finalOrder.items).toHaveLength(1);
  expect(finalOrder.items[0]).toMatchObject({ offerId: offer!.id, quantity, priceKopecks: offer!.priceKopecks });
  expect(finalOrder.deliveries).toHaveLength(1);
  expect(finalOrder.deliveries[0]).toMatchObject({ id: deliveryId, driverId: assigned.driverId, status: 'delivered', scheduledDate });
  const finalProductResponse = await page.request.get(`/api/v1/products/${product.id}`);
  expect(finalProductResponse.ok()).toBe(true);
  const finalProduct: { offers: Offer[] } = await finalProductResponse.json();
  expect(finalProduct.offers.find(item => item.id === offer!.id)!.stock).toBe(offer!.stock - quantity);
});
