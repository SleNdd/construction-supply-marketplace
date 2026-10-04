import { expect, test, type Page } from '@playwright/test';
import { reply } from './fixtures';

const offer = (id = 'cement', stock = 30, active = true) => ({
  id,
  productId: id,
  productName: id === 'cement' ? 'Цемент М500 50 кг' : `Материал ${id}`,
  productUnit: 'мешок',
  warehouseId: 'own',
  warehouseName: 'Склад поставщика',
  priceKopecks: 50000,
  stock,
  active,
  deliveryDays: 2,
  deliveryCostKopecks: 150000,
});
async function fixture(page: Page, failInitial = false) {
  const state = {
    rows: [offer(), offer('hidden', 0, false)],
    failLoad: failInitial,
    failProducts: false,
    conflict: false,
    lostReply: false,
    loadDelay: null as Promise<void> | null,
    mutationDelay: null as Promise<void> | null,
    mutations: [] as Array<{ method: string; id: string; body: Record<string, unknown> }>,
    queries: [] as string[],
  };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me')
      return reply(route, {
        user: {
          id: 'supplier',
          name: 'Поставщик',
          email: 'supplier@example.test',
          role: 'supplier',
        },
      });
    if (path === '/categories') return reply(route, []);
    if (path === '/products') {
      state.queries.push(url.search);
      if (state.failProducts) return reply(route, { message: 'Поиск временно недоступен' }, 503);
      return reply(route, {
        items: [
          {
            id: 'new-product',
            name: 'Новый цемент',
            unit: 'мешок',
            slug: 'new-cement',
            category: 'Смеси',
            priceFromKopecks: null,
          },
        ],
        total: url.searchParams.get('q') ? 1 : 101,
      });
    }
    if (path === '/supplier/warehouses')
      return reply(route, [{ id: 'own', name: 'Склад поставщика' }]);
    if (path === '/supplier/offers' && route.request().method() === 'GET') {
      await state.loadDelay;
      return reply(
        route,
        state.failLoad ? { message: 'Список недоступен' } : state.rows,
        state.failLoad ? 503 : 200,
      );
    }
    if (
      path.startsWith('/supplier/offers') &&
      ['PATCH', 'POST'].includes(route.request().method())
    ) {
      const method = route.request().method();
      const id = path.split('/').at(-1)!;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.mutations.push({ method, id, body });
      await state.mutationDelay;
      if (state.conflict)
        return reply(
          route,
          { error: 'offer_stock_changed', message: 'Доступный остаток изменился' },
          409,
        );
      if (method === 'POST')
        state.rows.push({ ...offer('created'), ...body, productName: 'Новый цемент' } as ReturnType<
          typeof offer
        >);
      else
        state.rows = state.rows.map((row) =>
          row.id === id ? ({ ...row, ...body } as ReturnType<typeof offer>) : row,
        );
      return reply(
        route,
        state.lostReply ? { message: 'Ответ потерян' } : { id },
        state.lostReply ? 503 : 200,
      );
    }
    throw new Error(`Неожиданный запрос: ${route.request().method()} ${path}`);
  });
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'Мои предложения' })).toBeVisible();
  return state;
}
const workspace = (page: Page) => page.getByRole('region', { name: 'Ассортимент поставщика' });
const row = (page: Page) =>
  workspace(page).getByRole('article').filter({ hasText: 'Цемент М500 50 кг' });
const dialog = (page: Page) => page.getByRole('dialog');
async function edit(page: Page) {
  await row(page).getByRole('button', { name: 'Изменить' }).click();
}

test('Сохранение без изменений закрывает редактор и сообщает результат без PATCH', async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(workspace(page).getByRole('status')).toHaveText('Изменений нет.');
  await expect(row(page).getByRole('button', { name: 'Изменить' })).toBeFocused();
  expect(state.mutations).toHaveLength(0);
});

test('Ошибка поиска товаров допускает явный повтор с тем же запросом', async ({ page }) => {
  const state = await fixture(page);
  state.failProducts = true;
  await workspace(page).getByRole('button', { name: 'Предложение', exact: true }).click();
  await dialog(page).getByLabel('Поиск товара', { exact: true }).fill('цемент');
  await expect(dialog(page).getByRole('alert')).toHaveText(/Поиск временно недоступен/);
  await expect(dialog(page).getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
  state.failProducts = false;
  await dialog(page).getByRole('button', { name: 'Повторить поиск товаров' }).click();
  await expect(dialog(page)).toContainText('Найдено: 1.');
  await dialog(page)
    .getByRole('combobox', { name: 'Товар', exact: true })
    .selectOption('new-product');
  const productQueries = state.queries.filter(
    (query) => new URLSearchParams(query).get('q') === 'цемент',
  );
  expect(productQueries.length).toBeGreaterThanOrEqual(2);
  expect(state.mutations).toHaveLength(0);
});

test('Изменение цены отправляет только изменённое поле; остаток не перезаписывается', async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await dialog(page).getByLabel('Цена, ₽', { exact: true }).fill('501,25');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(state.mutations).toEqual([
    { method: 'PATCH', id: 'cement', body: { priceKopecks: 50125 } },
  ]);
  await expect(row(page)).toContainText('30 мешков');
  await edit(page);
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('31');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(state.mutations[1].body).toEqual({ stock: 31, expectedStock: 30 });
});

test('Конфликт сохраняет черновик и требует явного принятия серверных значений', async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('45');
  await dialog(page).getByLabel('Цена, ₽', { exact: true }).fill('520');
  state.rows[0].stock = 27;
  state.conflict = true;
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toContainText('остаток: 27 мешков');
  await expect(dialog(page).getByLabel('Остаток', { exact: true })).toHaveValue('45');
  await expect(dialog(page).getByLabel('Цена, ₽', { exact: true })).toHaveValue('520');
  await expect(dialog(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Загрузить сохранённые значения' }).click();
  await expect(dialog(page).getByLabel('Остаток', { exact: true })).toHaveValue('27');
  await expect(dialog(page).getByLabel('Цена, ₽', { exact: true })).toHaveValue('500');
  state.conflict = false;
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('28');
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(state.mutations.map((mutation) => mutation.body)).toEqual([
    { priceKopecks: 52000, stock: 45, expectedStock: 30 },
    { stock: 28, expectedStock: 27 },
  ]);
});

test('Скрытие отправляет только active; дробный или слишком большой остаток отклоняется', async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  for (const value of ['1.5', '2147483648']) {
    await dialog(page).getByLabel('Остаток', { exact: true }).fill(value);
    await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog(page)).toContainText('остаток и срок — целыми');
    expect(state.mutations).toHaveLength(0);
  }
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('30');
  await dialog(page).getByRole('checkbox', { name: 'Активно — показывать покупателям' }).uncheck();
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(state.mutations[0].body).toEqual({ active: false });
  await expect(row(page)).toContainText('Скрыто');
});

test('Повторный клик блокируется до завершения записи и свежего GET', async ({ page }) => {
  const state = await fixture(page);
  await edit(page);
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('32');
  let releaseMutation!: () => void;
  let releaseLoad!: () => void;
  state.mutationDelay = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  state.loadDelay = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  await dialog(page)
    .getByRole('button', { name: 'Сохранить', exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect.poll(() => state.mutations.length).toBe(1);
  await expect(dialog(page).getByRole('button', { name: 'Закрыть' })).toBeDisabled();
  releaseMutation();
  await expect(dialog(page)).toBeHidden();
  await expect(row(page).getByRole('button', { name: 'Изменить' })).toBeDisabled();
  await expect(
    workspace(page).getByRole('button', { name: 'Предложение', exact: true }),
  ).toBeDisabled();
  releaseLoad();
  await expect(row(page).getByRole('button', { name: 'Изменить' })).toBeEnabled();
  expect(state.mutations).toHaveLength(1);
});

test('Потерянный ответ PATCH и ошибка обновления блокируют повтор; GET не заменяет черновик', async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('34');
  state.lostReply = true;
  state.failLoad = true;
  await dialog(page).getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Повторить загрузку' })).toBeEnabled();
  await expect(dialog(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  state.failLoad = false;
  await dialog(page).getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(dialog(page)).toContainText('остаток: 34 мешка');
  await expect(dialog(page).getByLabel('Остаток', { exact: true })).toHaveValue('34');
  await expect(dialog(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  expect(state.mutations).toHaveLength(1);
});

test('Начальная ошибка GET требует загрузки; поиск и фильтры показывают скрытое и пустое предложение', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await expect(workspace(page).getByRole('button', { name: 'Повторить загрузку' })).toBeEnabled();
  await expect(
    workspace(page).getByRole('button', { name: 'Предложение', exact: true }),
  ).toBeDisabled();
  state.failLoad = false;
  await workspace(page).getByRole('button', { name: 'Повторить загрузку' }).click();
  await workspace(page).getByRole('button', { name: 'Скрытые (1)' }).click();
  await expect(workspace(page).getByRole('article')).toHaveCount(1);
  await expect(workspace(page).getByRole('article')).toContainText('Материал hidden');
  await workspace(page).getByRole('button', { name: 'Нет в наличии (1)' }).click();
  await expect(workspace(page).getByRole('article')).toContainText('0 мешков');
  await workspace(page).getByLabel('Поиск по товару или складу').fill('не найдено');
  await expect(workspace(page)).toContainText('По этим условиям предложений нет');
  expect(state.mutations).toHaveLength(0);
});

test('Создание использует свой склад и поиск каталога; пустое значение не становится нулём', async ({
  page,
}) => {
  const state = await fixture(page);
  await workspace(page).getByRole('button', { name: 'Предложение', exact: true }).click();
  await expect(dialog(page)).toContainText('Показаны первые 100. Уточните поиск.');
  await dialog(page).getByLabel('Поиск товара', { exact: true }).fill('цемент');
  await expect(dialog(page)).toContainText('Найдено: 1.');
  await dialog(page)
    .getByRole('combobox', { name: 'Товар', exact: true })
    .selectOption('new-product');
  await expect(dialog(page).getByRole('combobox', { name: 'Склад', exact: true })).toHaveValue(
    'own',
  );
  await dialog(page).getByLabel('Цена, ₽', { exact: true }).fill('500');
  await dialog(page).getByRole('button', { name: 'Создать', exact: true }).click();
  expect(state.mutations).toHaveLength(0);
  await expect(dialog(page).getByLabel('Остаток', { exact: true })).toHaveValue('');
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('10');
  await dialog(page).getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(state.mutations[0].body).toEqual({
    productId: 'new-product',
    warehouseId: 'own',
    priceKopecks: 50000,
    stock: 10,
    deliveryDays: 2,
    deliveryCostKopecks: 0,
  });
  expect(
    state.queries.some(
      (query) =>
        new URLSearchParams(query).get('q') === 'цемент' &&
        new URLSearchParams(query).get('limit') === '100',
    ),
  ).toBe(true);
});

test('Потерянный ответ POST показывает найденную запись и не разрешает слепой повтор', async ({
  page,
}) => {
  const state = await fixture(page);
  await workspace(page).getByRole('button', { name: 'Предложение', exact: true }).click();
  await dialog(page)
    .getByRole('combobox', { name: 'Товар', exact: true })
    .selectOption('new-product');
  await dialog(page).getByLabel('Цена, ₽', { exact: true }).fill('500');
  await dialog(page).getByLabel('Остаток', { exact: true }).fill('10');
  state.lostReply = true;
  await dialog(page).getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog(page)).toContainText('Новый цемент:');
  await expect(dialog(page).getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
  expect(state.mutations).toHaveLength(1);
  await dialog(page).getByRole('button', { name: 'Закрыть и проверить ассортимент' }).click();
  await expect(
    workspace(page).getByRole('article').filter({ hasText: 'Новый цемент' }),
  ).toBeVisible();
});

for (const width of [360, 390, 768, 1440])
  for (const theme of ['light', 'dark']) {
    test(`Ассортимент и редактор: ${width}px, ${theme}, длинное название и клавиатура`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await fixture(page);
      state.rows[0].productName = 'Цемент для ответственных строительных конструкций '.repeat(6);
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await workspace(page).getByRole('button', { name: 'Обновить', exact: true }).click();
      await expect(workspace(page).getByRole('article').first()).toContainText(
        state.rows[0].productName,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await workspace(page)
        .getByRole('article')
        .first()
        .getByRole('button', { name: 'Изменить' })
        .click();
      await expect(dialog(page).getByLabel('Цена, ₽', { exact: true })).toBeFocused();
      const sizes = await dialog(page)
        .locator('button,input:not([type=checkbox]),select')
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      expect(sizes.every((height) => height >= 44)).toBe(true);
      expect(
        await dialog(page).evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      await expect(
        workspace(page).getByRole('article').first().getByRole('button', { name: 'Изменить' }),
      ).toBeFocused();
    });
  }
