import { expect, test, type Page } from '@playwright/test';
import { reply } from './fixtures';

const delivery = (id: string, supplierName: string, status = 'pending') => ({
  id, supplierName, status, orderId: `order-${id}`, orderStatus: 'paid',
  scheduledDate: '2026-10-08' as string | null, driverId: status === 'assigned' ? 'first-driver' : null as string | null,
  driverName: status === 'assigned' ? 'Первый водитель' : null as string | null,
  address: `Адрес ${id}`, destinationCoordinates: [48.05, 46.37],
  departurePoints: [{ warehouseId: id, name: `Склад ${id}`, address: `Отправление ${id}`, coordinates: [48.01, 46.31] }],
});
async function fixture(page: Page, rows = [delivery('old', 'Архивный', 'delivered'), delivery('first', 'Первый'), delivery('second', 'Второй', 'assigned'), delivery('working', 'В работе', 'in_transit')]) {
  const state = {
    rows, failLoad: false, failPatch: false,
    loadDelay: null as Promise<void> | null, patchDelay: null as Promise<void> | null,
    assignments: [] as Array<{ id: string; driverId: string; scheduledDate: string | null }>,
  };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'dispatcher', name: 'Диспетчер', role: 'dispatcher', email: 'dispatcher@example.test' } });
    if (path === '/categories') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === '/geo/config') return reply(route, { mapKey: null });
    if (path === '/geo/route') return reply(route, { source: 'demo', coordinates: [[48.01, 46.31], [48.05, 46.37]] });
    if (path === '/dispatch/drivers') return reply(route, [{ id: 'first-driver', name: 'Первый водитель' }, { id: 'second-driver', name: 'Второй водитель' }]);
    if (path === '/dispatch/deliveries') {
      await state.loadDelay;
      return reply(route, state.failLoad ? { message: 'Поставки недоступны' } : state.rows, state.failLoad ? 503 : 200);
    }
    const assignment = path.match(/^\/dispatch\/deliveries\/([^/]+)$/);
    if (assignment && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      state.assignments.push({ id: assignment[1], ...body });
      state.rows = state.rows.map(row => row.id === assignment[1] ? { ...row, ...body, status: 'assigned', driverName: body.driverId === 'first-driver' ? 'Первый водитель' : 'Второй водитель' } : row);
      await state.patchDelay;
      // Сервер записал назначение, но ответ клиенту потерялся.
      return reply(route, state.failPatch ? { message: 'Ответ назначения потерян' } : { id: assignment[1], ...body }, state.failPatch ? 503 : 200);
    }
    throw new Error(`Неожиданный запрос: ${path}`);
  });
  await page.goto('/workspace');
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled();
  return state;
}
const detail = (page: Page) => page.getByRole('region', { name: 'Выбранная поставка', exact: true });
const workspace = (page: Page) => page.getByRole('region', { name: 'Поставки диспетчера', exact: true });
const action = (page: Page) => detail(page).getByRole('button');

test('Группы отделяют планирование, работу и архив; детали и карта следуют выбору', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('button', { name: 'К планированию (2)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Выбор поставки').getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: /Второй.*Адрес second/ }).click();
  await expect(detail(page)).toContainText('Адрес second');
  await expect(detail(page)).toContainText('Заказ #order-se');
  await expect(action(page)).toHaveText('Сохранить назначение');
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Склад second');
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес second');
  await page.getByRole('button', { name: 'В работе (1)', exact: true }).click();
  await expect(detail(page)).toContainText('Адрес working');
  await expect(action(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Архив (1)' }).click();
  await expect(detail(page)).toContainText('Архивный');
  await expect(action(page)).toHaveCount(0);
});

test('Неоплаченный заказ объясняет блокировку; начатые и отменённые поставки не редактируются', async ({ page }) => {
  const unpaid = delivery('unpaid', 'Неоплаченный');
  unpaid.orderStatus = 'awaiting_payment';
  const state = await fixture(page, [unpaid, delivery('loaded', 'Загруженный', 'picked_up'), delivery('cancelled', 'Отменённый', 'cancelled')]);
  await expect(detail(page)).toContainText('Для назначения требуется подтверждение оплаты');
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toBeDisabled();
  await expect(action(page)).toBeDisabled();
  await page.getByRole('button', { name: 'В работе (1)' }).click();
  await expect(detail(page).getByRole('combobox', { name: 'Водитель', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Архив (1)' }).click();
  await expect(detail(page)).toContainText('Отменён');
  await expect(action(page)).toHaveCount(0);
  expect(state.assignments).toHaveLength(0);
});

test('Назначение и изменение сохраняют выбранного водителя и необязательную дату, включая null', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('second-driver');
  await page.getByLabel('Дата рейса', { exact: true }).fill('');
  await action(page).click();
  await expect(action(page)).toHaveText('Сохранить назначение');
  await expect(action(page)).toBeEnabled();
  await expect(page.getByLabel('Дата рейса', { exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('first-driver');
  await page.getByLabel('Дата рейса', { exact: true }).fill('2026-10-09');
  await action(page).click();
  await expect(action(page)).toBeEnabled();
  expect(state.assignments).toEqual([{ id: 'first', driverId: 'second-driver', scheduledDate: null }, { id: 'first', driverId: 'first-driver', scheduledDate: '2026-10-09' }]);
});

test('Двойной клик и смена поставки при задержке не меняют исходное назначение и чужой черновик', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: /Второй.*Адрес second/ }).click();
  await page.getByLabel('Дата рейса', { exact: true }).fill('2026-10-12');
  await page.getByRole('button', { name: /Первый.*Адрес first/ }).click();
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('second-driver');
  let releasePatch!: () => void;
  let releaseLoad!: () => void;
  state.patchDelay = new Promise<void>(resolve => { releasePatch = resolve; });
  state.loadDelay = new Promise<void>(resolve => { releaseLoad = resolve; });
  await action(page).dblclick();
  await expect.poll(() => state.assignments.length).toBe(1);
  await page.getByRole('button', { name: /Второй.*Адрес second/ }).click();
  await expect(detail(page)).toContainText('Адрес second');
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toBeDisabled();
  await expect(action(page)).toBeDisabled();
  releasePatch();
  await expect(page.getByRole('status').filter({ hasText: 'Загружаем поставки' })).toBeVisible();
  await expect(action(page)).toBeDisabled();
  releaseLoad();
  await expect(action(page)).toBeEnabled();
  await expect(page.getByLabel('Дата рейса', { exact: true })).toHaveValue('2026-10-12');
  expect(state.assignments).toEqual([{ id: 'first', driverId: 'second-driver', scheduledDate: '2026-10-08' }]);
  await page.getByRole('button', { name: /Первый.*Адрес first/ }).click();
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toHaveValue('second-driver');
});

test('Ошибка GET сохраняет прежнюю поставку и черновик только для чтения до успешной загрузки', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('second-driver');
  state.failLoad = true;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(workspace(page).getByRole('alert')).toContainText('Поставки недоступны');
  await expect(detail(page)).toContainText('Адрес first');
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toHaveValue('second-driver');
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toBeDisabled();
  await expect(action(page)).toBeDisabled();
  state.failLoad = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(action(page)).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toHaveValue('second-driver');
  expect(state.assignments).toHaveLength(0);
});

test('Сохранённое назначение при неудачном GET не даёт повторить PATCH', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('second-driver');
  state.failLoad = true;
  await action(page).click();
  await expect(workspace(page).getByRole('alert')).toContainText('Поставки недоступны');
  await expect(action(page)).toHaveText('Сохранить назначение');
  await expect(action(page)).toBeDisabled();
  expect(state.assignments).toHaveLength(1);
  state.failLoad = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(action(page)).toBeEnabled();
  expect(state.assignments).toHaveLength(1);
});

test('Потерянный ответ PATCH сохраняет черновик и требует свежего GET без автоматического повтора', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('second-driver');
  await page.getByLabel('Дата рейса', { exact: true }).fill('2026-10-11');
  state.failPatch = true;
  await action(page).click();
  await expect(workspace(page).getByRole('alert')).toContainText('Ответ назначения потерян');
  await expect(action(page)).toBeDisabled();
  await expect(page.getByLabel('Дата рейса', { exact: true })).toHaveValue('2026-10-11');
  state.failLoad = true;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(workspace(page).getByRole('alert')).toContainText('Поставки недоступны');
  await expect(action(page)).toBeDisabled();
  state.failLoad = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(action(page)).toHaveText('Сохранить назначение');
  await expect(action(page)).toBeEnabled();
  await expect(page.getByLabel('Дата рейса', { exact: true })).toHaveValue('2026-10-11');
  expect(state.assignments).toHaveLength(1);
});

test('Обновление сохраняет выбор, склад и черновик; смена группы во время GET сохраняет новый выбор', async ({ page }) => {
  const row = delivery('multi', 'Два склада', 'assigned');
  row.departurePoints.push({ ...row.departurePoints[0], warehouseId: 'another', name: 'Другой склад' });
  const state = await fixture(page, [row, delivery('old-first', 'Первый архивный', 'delivered'), delivery('old-second', 'Второй архивный', 'cancelled')]);
  await page.getByLabel('Склад отправления').selectOption('another');
  await page.getByRole('combobox', { name: 'Водитель', exact: true }).selectOption('second-driver');
  state.rows.reverse();
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Склад отправления')).toHaveValue('another');
  await expect(page.getByRole('combobox', { name: 'Водитель', exact: true })).toHaveValue('second-driver');
  let release!: () => void;
  state.loadDelay = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await page.getByRole('button', { name: 'Архив (2)' }).click();
  await page.getByRole('button', { name: /Второй архивный/ }).click();
  release();
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled();
  await expect(detail(page)).toContainText('Адрес old-second');
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес old-second');
});

test('Изменение этапа при GET сохраняет выбранную поставку в её новой группе', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: /Второй.*Адрес second/ }).click();
  state.rows = state.rows.map(row => row.id === 'second' ? { ...row, status: 'picked_up' } : row);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'В работе (2)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(detail(page)).toContainText('Адрес second');
  await expect(action(page)).toHaveCount(0);
});

test('Пустые группы показывают объяснение', async ({ page }) => {
  await fixture(page, []);
  await expect(page.getByText('Поставок к планированию пока нет.')).toBeVisible();
  await page.getByRole('button', { name: 'В работе (0)' }).click();
  await expect(page.getByText('Поставок в работе пока нет.')).toBeVisible();
  await page.getByRole('button', { name: 'Архив (0)' }).click();
  await expect(page.getByText('В архиве пока нет поставок.')).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
});

test('На 360 и 390px длинный список ограничен, поля и действия доступны в обеих темах', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await fixture(page, Array.from({ length: 30 }, (_, index) => delivery(`delivery-${index}`, `Поставщик с длинным названием ${index}`, 'assigned')));
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      const list = page.getByLabel('Выбор поставки');
      expect((await list.boundingBox())!.height).toBeLessThanOrEqual(215);
      for (const control of [page.getByRole('button', { name: 'К планированию (30)' }), action(page), page.getByRole('combobox', { name: 'Водитель', exact: true }), page.getByLabel('Дата рейса', { exact: true }), list.getByRole('button').first()]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await detail(page).scrollIntoViewIfNeeded();
      await expect(detail(page)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес delivery-0');
    }
  }
});
