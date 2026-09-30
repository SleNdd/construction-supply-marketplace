import { test, expect } from '@playwright/test';

type Offer = { id: string; priceKopecks: number; deliveryCostKopecks: number; stock: number };

test('Мобильный каталог и карточка показывают предложения и стоимость позиции', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/catalog');
  const card = page.locator('.catalog-products .product-card').first();
  await expect(card).toBeVisible();
  const width = await card.evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(320);
  const nameSize = await card.locator('.product-name').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(nameSize).toBeGreaterThanOrEqual(16);
  const categoryPhoto = page.locator('.catalog-products .material-photo img').first();
  await categoryPhoto.scrollIntoViewIfNeeded();
  await expect(categoryPhoto).toBeVisible();
  await expect(categoryPhoto).toHaveJSProperty('complete', true);
  expect(await categoryPhoto.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(categoryPhoto.locator('..').getByText('Фото категории')).toBeVisible();

  const productsResponse = await page.request.get('/api/v1/products?inStock=true&limit=100');
  expect(productsResponse.ok()).toBe(true);
  const products: Array<{ id: string }> = (await productsResponse.json()).items;
  expect(products.length).toBeGreaterThan(0);
  const productId = products[0].id;
  const detailsResponse = await page.request.get(`/api/v1/products/${productId}`);
  expect(detailsResponse.ok()).toBe(true);
  const details: { offers: Offer[] } = await detailsResponse.json();
  const offer = details.offers.find(item => item.stock >= 2);
  expect(offer).toBeTruthy();

  await page.goto(`/product/${productId}`);
  const jump = page.getByRole('link', { name: 'Доступные предложения', exact: true });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page).toHaveURL(/#product-offers$/);
  const offersSection = page.locator('#product-offers');
  await expect(offersSection).toBeInViewport();
  const specs = page.getByRole('heading', { name: 'Характеристики', exact: true });
  if (await specs.count()) {
    const nextHeading = await offersSection.evaluate(element => element.nextElementSibling?.querySelector('h2')?.textContent);
    expect(nextHeading).toBe('Характеристики');
  }

  const row = offersSection.locator('.offer-row').nth(details.offers.indexOf(offer!));
  await expect(row).toBeVisible();
  await row.getByRole('spinbutton', { name: 'Количество', exact: true }).fill('2');
  const totalKopecks = offer!.priceKopecks * 2 + offer!.deliveryCostKopecks;
  const fractionDigits = totalKopecks % 100 ? 2 : 0;
  const expected = new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
  }).format(totalKopecks / 100);
  await expect(row.locator('.offer-estimate b')).toHaveText(expected);
  await expect(row.locator('.offer-estimate')).toContainText('При оформлении берётся максимальная ставка доставки на поставщика.');
});
