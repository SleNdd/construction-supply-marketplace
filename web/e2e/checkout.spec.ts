import { test, expect, type Request, type Route } from '@playwright/test';
import { cartItem, mockCheckout, reply, validQuote } from './fixtures';

test('UI с фикстурами: новый адрес получает расчёт и подсказки раньше старого', async ({ page }) => {
  let oldQuote: Route | undefined;
  let oldSuggest: Route | undefined;
  const completed = new Set<Request>();
  // Подписываемся заранее: отмена старых запросов может произойти до их освобождения.
  page.on('requestfinished', request => completed.add(request));
  page.on('requestfailed', request => completed.add(request));
  await mockCheckout(page, async (route, path) => {
    if (path === '/quotes') {
      const address = route.request().postDataJSON().address;
      if (address === 'Старый адрес') oldQuote = route;
      else await reply(route, { ...validQuote, warnings: ['Расчёт нового адреса'] });
      return true;
    }
    if (path === '/geo/suggest') {
      if (new URL(route.request().url()).searchParams.get('q') === 'Старый адрес') oldSuggest = route;
      else await reply(route, { source: 'demo', items: [{ value: 'Новый адрес, дом 2' }] });
      return true;
    }
    return false;
  });
  const address = page.getByLabel('Адрес объекта или доставки');
  const confirm = page.getByRole('button', { name: 'Подтвердить заказ' });
  await address.fill('Старый адрес');
  await expect.poll(() => Boolean(oldQuote && oldSuggest)).toBe(true);
  await expect(confirm).toBeDisabled();
  await address.fill('Новый адрес');
  await expect(page.getByText('Расчёт нового адреса')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Новый адрес, дом 2' })).toBeVisible();
  await expect(confirm).toBeEnabled();
  await reply(oldQuote!, { ...validQuote, totalKopecks: 990000, warnings: ['Устаревший расчёт'] });
  await reply(oldSuggest!, { source: 'demo', items: [{ value: 'Старый адрес, дом 1' }] });
  await expect.poll(() => completed.has(oldQuote!.request()) && completed.has(oldSuggest!.request())).toBe(true);
  // Два кадра интерфейса после завершения или отмены обоих старых запросов.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(address).toHaveValue('Новый адрес');
  await expect(page.getByText('Устаревший расчёт')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Старый адрес, дом 1' })).toHaveCount(0);
  await expect(page.getByText('Расчёт нового адреса')).toBeVisible();
  await expect(page.getByText('Подсказки из учебного списка адресов.')).toBeVisible();
});

test('UI с фикстурами: новая дата сбрасывает расчёт, недоступный остаток запрещает заказ', async ({ page }) => {
  let datedQuote: Route | undefined;
  await mockCheckout(page, async (route, path) => {
    if (path !== '/quotes') return false;
    if (route.request().postDataJSON().requestedDate) datedQuote = route;
    else await reply(route, validQuote);
    return true;
  });
  await page.getByLabel('Адрес объекта или доставки').fill('Адрес проверки');
  const confirm = page.getByRole('button', { name: 'Подтвердить заказ' });
  await expect(confirm).toBeEnabled();
  await page.getByLabel('Желаемая дата').fill('2030-10-15');
  await expect(confirm).toBeDisabled();
  await expect(page.locator('.summary-total')).toContainText('После расчёта');
  await expect.poll(() => Boolean(datedQuote)).toBe(true);
  expect(datedQuote!.request().postDataJSON().requestedDate).toBe('2030-10-15');
  await reply(datedQuote!, { ...validQuote, unavailable: [{ offerId: cartItem.offerId, reason: 'stock' }] });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Часть позиций недоступна');
  await expect(confirm).toBeDisabled();
});

test('UI с фикстурами: ошибку подсказок можно обойти ручным адресом, ошибку расчёта — повтором', async ({ page }) => {
  let quoteAttempts = 0;
  await mockCheckout(page, async (route, path) => {
    if (path === '/geo/suggest') {
      await reply(route, { code: 'geocoding_unavailable', message: 'Подсказки временно недоступны' }, 502);
      return true;
    }
    if (path === '/quotes') {
      quoteAttempts++;
      if (quoteAttempts === 1) await reply(route, { code: 'quote_unavailable', message: 'Расчёт временно недоступен' }, 502);
      else await reply(route, validQuote);
      return true;
    }
    return false;
  });
  await page.getByLabel('Адрес объекта или доставки').fill('Адрес вручную');
  await expect(page.getByRole('status')).toContainText('Подсказки временно недоступны. Адрес можно ввести вручную.');
  await expect(page.getByText('Подсказки из учебного списка адресов.')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Расчёт временно недоступен');
  const confirm = page.getByRole('button', { name: 'Подтвердить заказ' });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить расчёт', exact: true }).click();
  await expect(confirm).toBeEnabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(quoteAttempts).toBe(2);
});
