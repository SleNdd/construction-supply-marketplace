import { expect, test, type Page } from '@playwright/test';
import { reply } from './fixtures';

const trip = (id: string, supplierName: string, status: string) => ({
  id, supplierName, status, orderId: `order-${id}`, scheduledDate: '2026-10-02', address: `Адрес ${id}`,
  destinationCoordinates: [48.05, 46.37],
  departurePoints: [{ warehouseId: id, name: `Склад ${id}`, address: `Отправление ${id}`, coordinates: [48.01, 46.31] }],
  items: [{ id: `item-${id}`, productName: `Материал ${id}`, quantity: 2, unit: 'мешок' }],
});
async function fixture(page: Page, rows = [trip('old-trip', 'Архивный', 'delivered'), trip('first-trip', 'Первый', 'assigned'), trip('second-trip', 'Второй', 'in_transit'), trip('pending-trip', 'Ожидающий', 'pending')]) {
  const state = {
    rows, failLoad: false, failEvent: false,
    loadDelay: null as Promise<void> | null,
    eventDelay: null as Promise<void> | null,
    events: [] as Array<{ id: string; status: string }>,
  };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'driver', name: 'Водитель', role: 'driver', email: 'driver@example.test' } });
    if (path === '/categories') return reply(route, []);
    if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
    if (path === '/geo/config') return reply(route, { mapKey: null });
    if (path === '/geo/route') return reply(route, { source: 'demo', coordinates: [[48.01, 46.31], [48.05, 46.37]] });
    if (path === '/driver/deliveries') {
      await state.loadDelay;
      return reply(route, state.failLoad ? { message: 'Рейсы недоступны' } : state.rows, state.failLoad ? 503 : 200);
    }
    const event = path.match(/^\/driver\/deliveries\/([^/]+)\/events$/);
    if (event) {
      const { status } = route.request().postDataJSON();
      state.events.push({ id: event[1], status });
      state.rows = state.rows.map(row => row.id === event[1] ? { ...row, status } : row);
      await state.eventDelay;
      // Моделируем потерянный ответ: сервер уже применил событие.
      if (state.failEvent) return reply(route, { message: 'Не удалось сохранить этап' }, 503);
      return reply(route, { status });
    }
    throw new Error(`Неожиданный запрос: ${path}`);
  });
  await page.goto('/workspace');
  await expect(page.getByRole('button', { name: /Активные/ })).toBeVisible();
  return state;
}
const detail = (page: Page) => page.getByRole('region', { name: 'Выбранный рейс', exact: true });
const workspace = (page: Page) => page.getByRole('region', { name: 'Рейсы водителя', exact: true });

test('Активные по умолчанию; выбор связывает детали, действие и карту, архив без действий', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('button', { name: 'Активные (2)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Архивный|Ожидающий/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Второй/ }).click();
  await expect(detail(page)).toContainText('Адрес second-trip');
  await expect(detail(page).getByRole('button', { name: 'Доставка завершена' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Склад second-trip');
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес second-trip');
  await page.getByRole('button', { name: 'Архив (1)' }).click();
  await expect(detail(page)).toContainText('Архивный');
  await expect(detail(page).getByRole('button')).toHaveCount(0);
});

test('Состав груза меняется вместе с рейсом и сохраняет разные единицы', async ({ page }) => {
  const first = trip('first', 'Первый', 'assigned');
  first.items = [{ id: 'tile', productName: 'Плитка 300×300', quantity: 3, unit: 'коробка' }, { id: 'paint', productName: 'Краска интерьерная', quantity: 2, unit: 'ведро' }];
  await fixture(page, [first, trip('second', 'Второй', 'assigned')]);
  const cargo = page.getByRole('list', { name: 'Материалы поставки', exact: true });
  await expect(cargo.getByRole('listitem')).toHaveCount(2);
  await expect(cargo.getByRole('listitem').filter({ hasText: 'Плитка 300×300' })).toContainText('3коробка');
  await expect(cargo.getByRole('listitem').filter({ hasText: 'Краска интерьерная' })).toContainText('2ведро');
  await page.getByRole('button', { name: /Второй/ }).click();
  await expect(cargo.getByRole('listitem')).toHaveCount(1);
  await expect(cargo).toContainText('Материал second');
  await expect(cargo).not.toContainText('Плитка 300×300');
});

test('Пустой состав архивной поставки обозначен и не даёт действий', async ({ page }) => {
  const row = trip('old', 'Архивный', 'delivered');
  row.items = [];
  await fixture(page, [row]);
  await page.getByRole('button', { name: 'Архив (1)' }).click();
  await expect(detail(page)).toContainText('Состав поставки не указан.');
  await expect(page.getByRole('list', { name: 'Материалы поставки', exact: true })).toHaveCount(0);
  await expect(detail(page).getByRole('button')).toHaveCount(0);
});

test('Переходы сохраняют контракт и завершение даёт доступ к архиву', async ({ page }) => {
  const state = await fixture(page);
  await detail(page).getByRole('button', { name: 'Материалы загружены' }).click();
  await expect(detail(page).getByRole('button', { name: 'Начать рейс' })).toBeEnabled();
  await detail(page).getByRole('button', { name: 'Начать рейс' }).click();
  await expect(detail(page).getByRole('button', { name: 'Доставка завершена' })).toBeEnabled();
  await expect(workspace(page).getByRole('status')).toContainText('Рейс #FIRST-TR: рейс начат.');
  await detail(page).getByRole('button', { name: 'Доставка завершена' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Рейс #FIRST-TR: доставка завершена/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Активные (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть завершённый рейс' }).click();
  await expect(detail(page)).toContainText('Первый');
  await expect(detail(page).getByRole('button')).toHaveCount(0);
  expect(state.events).toEqual(['picked_up', 'in_transit', 'delivered'].map(status => ({ id: 'first-trip', status })));
});

test('Задержанный ответ и двойной клик не переносят событие на другой выбранный рейс', async ({ page }) => {
  const state = await fixture(page);
  let releaseEventReply!: () => void;
  state.eventDelay = new Promise<void>(resolve => { releaseEventReply = resolve; });
  await detail(page).getByRole('button', { name: 'Материалы загружены' }).dblclick();
  await expect.poll(() => state.events.length).toBe(1);
  await page.getByRole('button', { name: /Второй/ }).click();
  await expect(detail(page)).toContainText('Адрес second-trip');
  await expect(detail(page).getByRole('button')).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес second-trip');
  releaseEventReply();
  await expect(detail(page).getByRole('button', { name: 'Доставка завершена' })).toBeEnabled();
  expect(state.events).toEqual([{ id: 'first-trip', status: 'picked_up' }]);
  await page.getByRole('button', { name: /Первый/ }).click();
  await expect(detail(page).getByRole('button', { name: 'Начать рейс' })).toBeEnabled();
});

test('Ответ обновления сохраняет рейс, выбранный в архиве во время загрузки', async ({ page }) => {
  const state = await fixture(page, [trip('first', 'Активный', 'assigned'), trip('old-first', 'Первый архивный', 'delivered'), trip('old-second', 'Второй архивный', 'cancelled')]);
  let releaseLoadReply!: () => void;
  state.loadDelay = new Promise<void>(resolve => { releaseLoadReply = resolve; });
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Загружаем рейсы' })).toBeVisible();
  await page.getByRole('button', { name: 'Архив (2)' }).click();
  await page.getByRole('button', { name: /Второй архивный/ }).click();
  releaseLoadReply();
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled();
  await expect(detail(page)).toContainText('Адрес old-second');
  await expect(detail(page).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес old-second');
  expect(state.events).toHaveLength(0);
});

test('Обновление сохраняет выбор; ошибка загрузки или события требует сверки перед новым действием', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: /Второй/ }).click();
  state.rows.reverse();
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(detail(page)).toContainText('Второй');
  state.failLoad = true;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(workspace(page).getByRole('alert')).toContainText('Рейсы недоступны');
  await expect(detail(page).getByRole('button')).toBeDisabled();
  state.failLoad = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(detail(page).getByRole('button')).toBeEnabled();
  state.failEvent = true;
  await detail(page).getByRole('button').click();
  await expect(workspace(page).getByRole('alert')).toContainText('Не удалось сохранить этап');
  await expect(detail(page).getByRole('button')).toBeDisabled();
  expect(state.events).toHaveLength(1);
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(detail(page).getByRole('button', { name: 'Материалы загружены' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Архив (2)' })).toBeVisible();
});

test('Пустые группы объясняют отсутствие рейсов', async ({ page }) => {
  await fixture(page, []);
  await expect(page.getByText('Активных рейсов пока нет.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Архив (0)' }).click();
  await expect(page.getByText('В архиве пока нет рейсов.')).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
});

test('Отменённый рейс в архиве сохраняет статус и не имеет действий', async ({ page }) => {
  await fixture(page, [trip('cancelled', 'Отменённый', 'cancelled'), trip('unknown', 'Неизвестный', 'constructor')]);
  await expect(page.getByRole('button', { name: 'Активные (0)' })).toBeVisible();
  await page.getByRole('button', { name: 'Архив (1)' }).click();
  await expect(detail(page)).toContainText('Отменён');
  await expect(detail(page).getByRole('button')).toHaveCount(0);
});

test('Сохранённый этап с неудачным обновлением не позволяет повторить POST', async ({ page }) => {
  const state = await fixture(page);
  state.failLoad = true;
  await detail(page).getByRole('button', { name: 'Материалы загружены' }).click();
  await expect(workspace(page).getByRole('alert')).toContainText('Рейсы недоступны');
  await expect(detail(page).getByRole('button', { name: 'Начать рейс' })).toBeDisabled();
  expect(state.events).toEqual([{ id: 'first-trip', status: 'picked_up' }]);
  state.failLoad = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(detail(page).getByRole('button', { name: 'Начать рейс' })).toBeEnabled();
});

test('Успешное обновление сохраняет выбранный склад того же рейса', async ({ page }) => {
  const row = trip('multi', 'Два склада', 'assigned');
  row.departurePoints.push({ ...row.departurePoints[0], warehouseId: 'another', name: 'Другой склад' });
  await fixture(page, [row]);
  await page.getByLabel('Склад отправления').selectOption('another');
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByLabel('Склад отправления')).toHaveValue('another');
  await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Другой склад');
});

test('На телефоне длинный список ограничен, выбранный рейс доступен в двух темах', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, Array.from({ length: 30 }, (_, index) => trip(`trip-${index}`, `Поставщик ${index}`, 'assigned')));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    const list = page.getByLabel('Выбор рейса');
    expect((await list.boundingBox())!.height).toBeLessThanOrEqual(215);
    for (const control of [page.getByRole('button', { name: 'Активные (30)' }), detail(page).getByRole('button'), list.getByRole('button').first()]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await detail(page).scrollIntoViewIfNeeded();
    await expect(detail(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Карта поставки' })).toContainText('Доставка: Адрес trip-0');
  }
});
