import { expect, type Page, type Route } from '@playwright/test';

export const cartItem = { offerId: 'fixture-offer', quantity: 1, productId: 'fixture-product', productName: 'Материал для проверки UI', supplierName: 'Учебный поставщик', priceKopecks: 10000, unit: 'мешок' };
export const validQuote = { productTotalKopecks: 10000, deliveryTotalKopecks: 20000, totalKopecks: 30000, unavailable: [], zoneAvailable: true, warnings: [] };
export const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Все запросы API подменены: фикстуры проверяют поведение UI, сервер здесь не проверяется.
export async function mockCheckout(page: Page, handler: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(item => localStorage.setItem('objectmarket-cart', JSON.stringify([item])), cartItem);
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (await handler(route, path)) return;
    if (path === '/auth/me') return reply(route, { user: { id: 'fixture-buyer', name: 'Проверка UI', email: 'fixture@example.test', role: 'buyer' } });
    if (path === '/categories' || path === '/projects') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === '/geo/suggest') return reply(route, { source: 'dadata', items: [] });
    throw new Error(`Неожиданный запрос API в фикстуре: ${route.request().method()} ${path}`);
  });
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Оформление заказа', exact: true })).toBeVisible();
}

export type DemoRole = 'buyer' | 'supplier' | 'dispatcher' | 'driver' | 'admin';

export async function loginRole(page: Page, role: DemoRole) {
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Вход', exact: true });
  await dialog.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await dialog.getByLabel('Пароль').fill('Demo2026!');
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect((await response.json()).user.role).toBe(role);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
}

export async function loginBuyer(page: Page) {
  await loginRole(page, 'buyer');
}
