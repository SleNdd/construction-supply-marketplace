import { expect, test } from '@playwright/test';

test('Главная показывает пример закупки без потери читаемости на узком экране', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const preview = page.getByRole('complementary', { name: 'Пример ведомости материалов' });
  await expect(preview).toContainText('Пример расчёта');
  await expect(preview).toContainText('Напольная плитка');
  await expect(preview).toContainText('19 упак.');
  await expect(preview).toContainText('8 мешков');
  await expect(preview).toContainText('3 ведра');
  await expect(preview.getByRole('link', { name: 'Открыть объекты' })).toHaveAttribute('href', '/projects');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await preview.evaluate(element => getComputedStyle(element).animationName)).toBe('none');

  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await page.getByRole('button', { name: 'Закрыть меню' }).click();
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(preview).toBeInViewport();
});
