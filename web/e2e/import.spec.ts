import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Route } from '@playwright/test';
import { loginBuyer, reply } from './fixtures';
import { parseCsv, parseImportRows, importTemplate } from '../src/lib/project-import';
import type { Product } from '../src/lib/api';

const projectId = '22222222-2222-2222-2222-222222222222';
const productId = '11111111-1111-1111-1111-111111111111';
const product = { id: productId, name: 'Смесь «Пример», строительная', unit: 'мешок', category: 'Смеси', slug: 'mix', priceFromKopecks: 10000 } satisfies Product;
const csv = (lines: string) => `productId,quantity,stageDate\n${lines}`;
const upload = (page: Page, content: string, name = 'needs.csv') => page.getByLabel('Выбрать файл CSV / XLSX').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
const preview = (page: Page) => page.getByRole('list', { name: 'Предпросмотр ведомости' });

async function setup(page: Page, options: { products?: (route: Route) => Promise<void>; send?: (route: Route) => Promise<void> } = {}) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return reply(route, { user: { id: 'buyer', name: 'Покупатель', role: 'buyer', email: 'buyer@example.test' } });
    if (path === '/categories' || path === '/projects') return reply(route, []);
    if (path === '/products') return options.products ? options.products(route) : reply(route, { items: [product], total: 1, page: 1 });
    if (path === `/projects/${projectId}`) return reply(route, { id: projectId, name: 'Импорт объекта', address: 'Астрахань', items: [] });
    if (path === `/projects/${projectId}/items`) return options.send ? options.send(route) : reply(route, { id: 'added' });
    if (path === '/geo/config' || path === '/geo/route') return reply(route, { source: 'demo', mapKey: null });
    if (path === '/geo/suggest') return reply(route, { source: 'demo', items: [] });
    throw new Error(`Unexpected import API: ${path}`);
  });
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Импорт объекта' })).toBeVisible();
}

test('Ведомость: BOM-шаблон читает обратно реальные ID, кавычки и единицу', async ({ page }) => {
  await setup(page);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV-шаблон' }).click();
  const download = await waiting; const content = await readFile((await download.path())!);
  expect([...content.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(parseImportRows(parseCsv(content.toString()))[0]).toMatchObject({ productId, quantity: 1, sourceLine: 2 });
  await upload(page, content.toString());
  await expect(preview(page)).toContainText(product.name);
  await expect(preview(page)).toContainText('1 мешок');
  await expect(page.getByText('Допустимых: 1. С ошибками: 0. Добавлено: 0.', { exact: true })).toBeVisible();
});

test('Ведомость: заголовки, пустой файл, только заголовок, календарь и безопасное целое', () => {
  expect(() => parseImportRows(parseCsv(''))).toThrow('Файл пуст');
  expect(() => parseImportRows(parseCsv('productId,quantity,stageDate'))).toThrow('только заголовок');
  expect(() => parseImportRows(parseCsv('название,quantity,stageDate\nСмесь,1,'))).toThrow('Неверный заголовок');
  const rows = parseImportRows(parseCsv(csv(`${productId},2,2030-02-29\n\n${productId},3,2032-02-29\n${productId},9007199254740992,`)));
  expect(rows[0].error).toContain('существующую дату');
  expect(rows[1]).toMatchObject({ sourceLine: 4, stageDate: '2032-02-29' }); expect(rows[1].error).toBeUndefined();
  expect(rows[2].error).toContain('целым');
  expect(parseImportRows(parseCsv(csv(`${productId},2147483647,`)))[0].error).toBeUndefined();
  expect(parseImportRows(parseCsv(csv(`${productId},2147483648,`)))[0].error).toContain('2 147 483 647');
  expect(parseImportRows(parseCsv(importTemplate(product)))[0].error).toBeUndefined();
  expect(() => parseImportRows(parseCsv(csv(Array(201).fill(`${productId},1,`).join('\n'))))).toThrow('200');
  const multiline = parseImportRows(parseCsv(`ID товара;Количество;Дата этапа;Название товара;Единица\n${productId};1;;"Название\nпродолжение";мешок\n${productId};2;;;мешок`));
  expect(multiline.map(row => row.sourceLine)).toEqual([2, 4]);
  expect(parseImportRows(parseCsv(csv(`${productId},1,0000-01-01`)))[0].error).toContain('существующую дату');
  const unsafe = parseCsv(importTemplate({ ...product, name: '=HYPERLINK("https://example.test")', unit: '\t@SUM(1)' }));
  expect(unsafe[1].slice(3)).toEqual(['\'=HYPERLINK("https://example.test")', "'\t@SUM(1)"]);
  expect(parseImportRows(unsafe)[0].productId).toBe(productId);
});

test('Ведомость: каталог со второй страницы и восстановление после отказа проверки', async ({ page }) => {
  let fail = true; const pages: number[] = [];
  await setup(page, { products: async route => {
    if (fail) return route.fulfill({ status: 503, json: { message: 'Недоступно' } });
    const current = Number(new URL(route.request().url()).searchParams.get('page')); pages.push(current);
    await reply(route, { items: current === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...product, id: `other-${i}` })) : [product], total: 101 });
  } });
  await upload(page, csv(`${productId},1,`));
  await expect(page.getByRole('region', { name: 'Импорт ведомости' }).getByRole('alert')).toContainText('Товары пока не проверены');
  await expect(page.getByRole('button', { name: /Добавить допустимые/ })).toBeDisabled();
  fail = false; await page.getByRole('button', { name: 'Повторить проверку каталога' }).click();
  await expect(preview(page)).toContainText(product.name); expect(pages).toEqual([1, 2]);
  await expect(page.getByRole('button', { name: /Добавить допустимые/ })).toBeEnabled();
});

test('Ведомость: старое чтение файла не заменяет новый предпросмотр', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === 'slow.csv') await new Promise<void>(resolve => { (window as unknown as { releaseRead: () => void }).releaseRead = resolve; });
      return original.call(this);
    };
  });
  await setup(page);
  await upload(page, csv(`${productId},1,`), 'slow.csv');
  await expect(page.getByRole('region', { name: 'Импорт ведомости' }).getByRole('status')).toContainText('Читаем slow.csv');
  await upload(page, csv(`${productId},7,`));
  await expect(preview(page)).toContainText('7 мешков');
  await page.evaluate(() => (window as unknown as { releaseRead: () => void }).releaseRead());
  await expect(preview(page)).toContainText('7 мешков');
  await expect(preview(page).getByRole('listitem')).toHaveCount(1);
});

test('Ведомость: старый ответ каталога не заменяет новый файл', async ({ page }) => {
  let release!: () => void; let first = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await setup(page, { products: async route => {
    if (first && new URL(route.request().url()).searchParams.has('page')) { first = false; await held; try { await reply(route, { items: [], total: 0 }); } catch { /* Отменённый браузером запрос. */ } return; }
    await reply(route, { items: [product], total: 1 });
  } });
  first = true;
  await upload(page, csv(`${productId},1,`));
  await expect(page.getByRole('region', { name: 'Импорт ведомости' }).getByRole('status')).toContainText('Проверяем');
  await upload(page, csv(`${productId},8,`));
  await expect(preview(page)).toContainText('8 мешков'); release();
  await expect(preview(page)).toContainText(product.name);
  await expect(page.getByRole('button', { name: /Добавить допустимые/ })).toBeEnabled();
});

test('Ведомость: частичный результат, блокировка файла и повтор только неподтверждённой строки', async ({ page }) => {
  const quantities: number[] = []; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await setup(page, { send: async route => {
    const quantity = route.request().postDataJSON().quantity; quantities.push(quantity);
    if (quantities.length === 1) await held;
    if (quantities.length === 2) return route.fulfill({ status: 503, json: { message: 'Ответ не подтверждён' } });
    await reply(route, { id: 'added' });
  } });
  await upload(page, csv(`${productId},2,\n${productId},3,`));
  const add = page.getByRole('button', { name: /Добавить допустимые/ }); await expect(add).toBeEnabled(); await add.click();
  await expect(page.getByLabel('Выбрать файл CSV / XLSX')).toBeDisabled(); await expect(add).toBeDisabled();
  await add.evaluate(button => (button as HTMLButtonElement).click()); release();
  await expect(page.getByText('Допустимых: 0. С ошибками: 1. Добавлено: 1.', { exact: true })).toBeVisible();
  await expect(preview(page)).toContainText('Не подтверждено');
  await page.getByRole('button', { name: 'Повторить неподтверждённые строки' }).click();
  await expect(page.getByText('Допустимых: 0. С ошибками: 0. Добавлено: 2.', { exact: true })).toBeVisible();
  expect(quantities).toEqual([2, 3, 3]);
});

for (const theme of ['light', 'dark']) for (const width of [390, 1024, 1440]) {
  test(`Ведомость: ${theme}, ${width}px, имена, причины и доступные контролы`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('objectmarket-theme', theme), theme);
    await setup(page); await upload(page, csv(`${productId},5,2030-02-30\n${productId},2,2030-03-01`));
    await expect(preview(page)).toContainText('существующую дату');
    await expect(preview(page)).toContainText(product.name);
    await expect(preview(page)).toContainText('Строка 3');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await page.getByLabel('Выбрать файл CSV / XLSX').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByRole('button', { name: 'Скачать CSV-шаблон' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
}

test('Настоящий API: CSV-шаблон, имя и единица, дата этапа и одна сохранённая позиция', async ({ page }) => {
  await page.goto('/catalog'); await loginBuyer(page);
  const created = await page.request.post('/api/v1/projects', { headers: { Origin: new URL(page.url()).origin }, data: { name: `E2E импорт ${randomUUID()}`, address: 'Астрахань, ул. Савушкина, 6' } });
  expect(created.ok()).toBe(true); const project = await created.json();
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать CSV-шаблон' }).click();
  const download = await waiting; const template = (await readFile((await download.path())!)).toString();
  const source = parseImportRows(parseCsv(template))[0];
  const detailsResponse = await page.request.get(`/api/v1/products/${source.productId}`); expect(detailsResponse.ok()).toBe(true);
  const material = await detailsResponse.json();
  await upload(page, template.replace('"1";"";', '"2";"2032-02-29";'));
  await expect(preview(page)).toContainText(material.name); await expect(preview(page)).toContainText(`2 ${material.unit}`);
  const add = page.getByRole('button', { name: /Добавить допустимые/ }); await expect(add).toBeEnabled(); await add.click();
  await expect(page.getByText('Допустимых: 0. С ошибками: 0. Добавлено: 1.', { exact: true })).toBeVisible();
  await expect(page.locator('.needs-list')).toContainText(material.name);
  const saved = await page.request.get(`/api/v1/projects/${project.id}`); expect(saved.ok()).toBe(true);
  const items = (await saved.json()).items;
  expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ productId: source.productId, quantity: 2, stageDate: '2032-02-29', productName: material.name, unit: material.unit });
  await expect(add).toBeDisabled(); await add.evaluate(button => (button as HTMLButtonElement).click());
  await page.reload(); await expect(page.locator('.needs-list .need-row')).toHaveCount(1);
});

// XLSX содержит числовую ячейку даты с Excel-форматом yyyy-mm-dd.
test.describe('XLSX в западном часовом поясе', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('Ведомость: XLSX сохраняет импорт ID, количества и даты', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Выбрать файл CSV / XLSX').setInputFiles({ name: 'needs.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('UEsDBBQAAAAIAKK6QV3inl2H0AAAAA4CAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2SsU7EQAxEfyXaFt36oKBASRqgBQp+wGycyyq79mrtO3J/jxIEBQXXXDWFR29G1rTv50LaLDmxdm4yKw8AGibKqF4K8ZLTKDWjqZd6gIJhxgPB3X5/D0HYiG1nK8P17RONeEzWPC9GrFG4c0tOrnn89q1RncNSUgxoURjWK/Tt64lqjQM1b1jtBTN1DpYEn1LnD5HZ/w858fCn6U7GMQYaJBwzsXktlXDQichy8pv6jJFvLufralbY5PbKRX75F3qonRPptb+wQX+SYZtB/wVQSwMEFAAAAAgAorpBXQXwmiaoAAAA8AAAAA8AAAB4bC93b3JrYm9vay54bWyNzzEOgjAUBuCrkHcACw4OBJhcOEaFhzS0fU1fjaw6O3kW3QxnKDcyAdmd/uFPvj9/cSU/nIiGZDTacgl9CC4XgpsejeQdObSj0R15IwPvyJ8FO4+y5R4xGC32aXoQRioLq5D7fwzqOtXgkZqLQRtWxKOWQZHlXjmGqlgW+JeJlQZLiM/4jq84xU+c5tt8nx+QLH3dlpBB4nPVluDrNgNRFWIjxPay+gJQSwMEFAAAAAgAorpBXRd2WXmeAAAAcAEAABoAAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc62QPQqDQBCFr7LsARy1SBHUKo1t8ALLOrri/rEzEr19ICGJAYsUqYb3iu99THVFq3gKnswUSazOeqqlYY5nANIGnaIsRPSrs0NITjFlIY0QlZ7ViFDm+QnSniGbas8UbV/L1PaFFN0W8Rd2GIZJ4yXoxaHngwm4hTSTQWQpOpVG5Fq+K4LHKbLVWQnHMuU/ZYg3i/QxeebXPHw9uLkDUEsDBBQAAAAIAKK6QV3EAllhmwAAAOsAAAANAAAAeGwvc3R5bGVzLnhtbFXPMQuDMBAF4L8Sbq+nUhxKkqVQ6NylazCxFnKJeBHMvy9Bse108Hjvg5OcsneP0bkkVvKBFYwpTRdE7kdHhqs4ubCSH+JMJnEV5xfyNDtjuYzIY1vXHZJ5B9AyLHSjxKKPS0gKmiMS27lbBU13BrFx12idgpxzPhGdrAXUEndDy955/xwOrAUt1+EHqkv9Lyl0Ifallvh9T38AUEsDBBQAAAAIAKK6QV1NjBTX0AAAALYBAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sdZHBTsMwDIZfpcqdeQ0TIORaAnbhzBNEbVgjmqTYXjveHnUb1ZBaHyzrtz7rt41j5i9pvdfiFLsklWlV+2cAqVsfnWxy79Mpdp+Zo1PZZD6A9Oxdc4ZiB3a7fYDoQjKEZ23v1BFyHguuTGkI66l4KU2hlQmpC8l/KBvCIIRKPefmWOt7g6CEMIlQX6HXNej76JIG/Vlg3tYYUXfwe6f+PwScx9mune3alSnlNe4W0l8sbTJNHmiHMNx6taaQy5EG2j3Zx/u5f7EFNxeF+VX0C1BLAQIUABQAAAAIAKK6QV3inl2H0AAAAA4CAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQAFAAAAAgAorpBXQXwmiaoAAAA8AAAAA8AAAAAAAAAAAAAAIABAQEAAHhsL3dvcmtib29rLnhtbFBLAQIUABQAAAAIAKK6QV0Xdll5ngAAAHABAAAaAAAAAAAAAAAAAACAAdYBAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUABQAAAAIAKK6QV3EAllhmwAAAOsAAAANAAAAAAAAAAAAAACAAawCAAB4bC9zdHlsZXMueG1sUEsBAhQAFAAAAAgAorpBXU2MFNfQAAAAtgEAABgAAAAAAAAAAAAAAIABcgMAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAABQAFAEcBAAB4BAAAAAA=', 'base64') });
  await expect(preview(page)).toContainText(product.name);
  await expect(preview(page)).toContainText('4 мешка');
  await expect(preview(page)).toContainText('2032-02-29');
  await expect(page.getByRole('button', { name: /Добавить допустимые/ })).toBeEnabled();
});

});
