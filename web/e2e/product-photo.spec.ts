import { expect, test } from '@playwright/test';
import { reply } from './fixtures';

const id = 'bbbbbbbb-0000-0000-0000-000000000001';

for (const broken of [false, true]) {
  test(`Фото товара из карточки: ${broken ? 'ошибка возвращает фотографию категории' : 'показывается вместо фотографии категории'}`, async ({ page }) => {
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      if (path === '/auth/me') return reply(route, { user: null });
      if (path === '/categories') return reply(route, []);
      if (path === '/products') return reply(route, { items: [], total: 0, page: 1 });
      if (path === `/products/${id}`) return reply(route, { id, name: 'Кирпич с фотографией', category: 'Кирпич', unit: 'шт.', offers: [], imageUrl: broken ? '/images/unavailable-product.jpg' : '/images/materials/wood-stack.jpg' });
      throw new Error(`Неожиданный запрос карточки: ${path}`);
    });
    if (broken) await page.route('**/_next/image?**', async route => {
      const url = new URL(route.request().url()).searchParams.get('url');
      if (url === '/images/unavailable-product.jpg') return route.fulfill({ status: 404, body: '' });
      return route.continue();
    });
    await page.goto(`/product/${id}`);
    const image = page.locator('.detail-visual img');
    await expect(image).toHaveAttribute('alt', broken ? 'Фото категории «Кирпич»' : 'Кирпич с фотографией');
    await expect(image).toHaveJSProperty('complete', true);
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('.detail-visual .photo-note')).toHaveText(broken ? 'Фото категории' : 'Фото товара');
  });
}
