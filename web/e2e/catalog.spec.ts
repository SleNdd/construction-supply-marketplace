import { test, expect } from '@playwright/test';

test('Настоящий каталог: поиск применяется по отправке и сохраняется в URL', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByText(/Найдено товаров:/)).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Поиск по каталогу' });
  await search.fill('цемент');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  const searched = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/products' && new URL(response.url()).searchParams.get('q') === 'цемент');
  await page.getByRole('button', { name: 'Искать', exact: true }).click();
  const response = await searched;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.items.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/q=/);
  expect(new URL(page.url()).searchParams.get('q')).toBe('цемент');
  await expect(page.getByText(`Найдено товаров: ${result.total}`, { exact: true })).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(result.items.length);
  for (const name of await page.locator('.product-name').allTextContents()) expect(name.toLowerCase()).toContain('цемент');
  await page.reload();
  await expect(search).toHaveValue('цемент');
});

test('Настоящий каталог: категория, включённые границы цены и наличие сочетаются', async ({ page }) => {
  const categoriesResponse = await page.request.get('/api/v1/categories');
  expect(categoriesResponse.ok()).toBe(true);
  const categories: Array<{ id: string; slug: string; name: string }> = await categoriesResponse.json();
  const productsResponse = await page.request.get('/api/v1/products?inStock=true&limit=100');
  expect(productsResponse.ok()).toBe(true);
  const { items }: { items: Array<{ id: string; categoryId: string; priceFromKopecks: number }> } = await productsResponse.json();
  const product = items.find(item => item.priceFromKopecks % 100 === 0);
  expect(product, 'seed must contain an in-stock product with a whole-ruble price').toBeTruthy();
  const category = categories.find(item => item.id === product!.categoryId);
  expect(category).toBeTruthy();
  const price = String(product!.priceFromKopecks / 100);
  await page.goto('/catalog');
  await page.getByRole('button', { name: category!.name, exact: true }).click();
  await page.getByLabel('От', { exact: true }).fill(price);
  await page.getByLabel('До', { exact: true }).fill(price);
  await page.getByLabel('Только в наличии').check();
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/products' && url.searchParams.get('inStock') === 'true' && url.searchParams.has('maxPriceKopecks');
  });
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.items.length).toBeGreaterThan(0);
  for (const item of result.items) {
    expect(item.categoryId).toBe(category!.id);
    expect(item.priceFromKopecks).toBe(product!.priceFromKopecks);
    const details = await (await page.request.get(`/api/v1/products/${item.id}`)).json();
    const stockedPrices = details.offers.filter((offer: { stock: number }) => offer.stock > 0).map((offer: { priceKopecks: number }) => offer.priceKopecks);
    expect(Math.min(...stockedPrices)).toBe(item.priceFromKopecks);
  }
  await expect(page.locator('.product-card')).toHaveCount(result.items.length);
  await expect(page.locator(`.product-name[href="/product/${product!.id}"]`)).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get('category')).toBe(category!.slug);
  expect(params.get('price_min')).toBe(price);
  expect(params.get('price_max')).toBe(price);
  expect(params.get('in_stock')).toBe('1');
  await page.getByLabel('От', { exact: true }).fill('20');
  await page.getByLabel('До', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Верхняя граница цены должна быть не меньше нижней.');
  expect(new URL(page.url()).searchParams.get('price_min')).toBe(price);
});

test('Экран 390: фокус и прокрутка фильтров, закрытие подложкой, Escape и расширением экрана', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/catalog');
  const trigger = page.getByRole('button', { name: /^Фильтры/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтры каталога' });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('От', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const last = dialog.getByRole('link', { name: 'К калькуляторам' });
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть фильтры', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await trigger.click();
  // Подложка скрыта от скринридера; нажимаем на открытый край справа от панели.
  await page.locator('.catalog-filter-backdrop').click({ position: { x: 370, y: 300 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(page.getByRole('dialog', { name: 'Фильтры каталога' })).toHaveCount(0);
  await expect(page.locator('#catalog-filters')).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await expect(page.locator('#main-content')).toBeFocused();
});
