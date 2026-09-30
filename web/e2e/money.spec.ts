import { expect, test } from '@playwright/test';
import { money } from '../src/lib/api';
import { reply } from './fixtures';

test('Денежный формат сохраняет целые копейки, включая bigint сводного отчёта', () => {
  expect(money(0)).toBe('0\u00a0₽');
  expect(money(105)).toBe('1,05\u00a0₽');
  expect(money('9007199254740993')).toBe('90\u00a0071\u00a0992\u00a0547\u00a0409,93\u00a0₽');
  expect(money('9007199254740991')).toBe(money(Number.MAX_SAFE_INTEGER));
  for (const amount of [null, undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', 'NaN', '-1', '1.5']) expect(money(amount)).toBe('—');
});

test('UI сводки с фикстурой показывает bigint без округления через Number', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'admin', name: 'Администратор', role: 'admin' } });
    if (path === '/categories') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === '/reports/summary') return reply(route, { orders: { count: 1, totalKopecks: '9007199254740993' }, deliveries: [], note: 'Учебные данные' });
    throw new Error(`Неожиданный запрос сводки: ${path}`);
  });
  await page.goto('/workspace');
  await expect(page.locator('.report-stats').getByText('90 071 992 547 409,93 ₽', { exact: true })).toBeVisible();
});
