import { expect, test } from '@playwright/test';
import { reply } from './fixtures';

test('О проекте доступно из подвала и объясняет ограничения в обеих темах', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { message: 'Не авторизован' }, 401);
    if (path === '/categories') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0 });
    throw new Error(`Неожиданный запрос в проверке страницы «О проекте»: ${path}`);
  });
  await page.goto('/');
  await expect(page.locator('.announcement')).toHaveCount(0);
  await page.getByRole('contentinfo').getByRole('link', { name: 'О проекте' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'ОбъектМаркет', exact: true })).toBeVisible();
  await expect(page.getByText('Функциональный прототип системы снабжения строительного объекта.')).toBeVisible();
  await expect(page.getByText('Статусы поставки водитель отмечает вручную.', { exact: false })).toBeVisible();
  await expect(page.getByText('Тестовая оплата меняет статус заказа. Средства не списываются.')).toBeVisible();
  await expect(page.getByText('Она не привязана к адресу заказа', { exact: false })).toBeVisible();
  await expect(page.getByText('работа с действующими ключами пока не проверена', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Переключить тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  const projects = page.getByRole('link', { name: 'Открыть мои объекты' });
  await expect(projects).toBeVisible();
  const bounds = await projects.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Данные и ограничения' })).toBeVisible();
});
