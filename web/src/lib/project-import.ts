import type { Product } from './api';

// Количество потребности хранится в PostgreSQL integer.
export const MAX_IMPORT_QUANTITY = 2_147_483_647;

export type ImportRow = {
  sourceLine: number; productId: string; quantity: number; quantityText: string;
  stageDate?: string; product?: Product; error?: string; sendError?: string; imported?: boolean;
};

// Разделители и переносы внутри кавычек остаются частью ячейки.
export function parseCsv(text: string): unknown[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  let line = 1; let sourceLine = 1;
  const header = text.split(/\r?\n/, 1)[0];
  const delimiter = (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(Object.assign(row, { sourceLine })); row = []; cell = ''; sourceLine = line + 1;
    } else cell += char;
    if (char === '\n' || (char === '\r' && (text[i + 1] !== '\n' || !quoted))) line++;
  }
  if (quoted) throw new Error('Не закрыты кавычки в CSV.');
  if (cell || row.length) { row.push(cell); rows.push(Object.assign(row, { sourceLine })); }
  return rows;
}

function dateText(value: unknown): string | undefined {
  // XLSX-читатель возвращает дату ячейки в UTC, без местного сдвига суток.
  if (value instanceof Date) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  return String(value ?? '').trim() || undefined;
}

export function parseImportRows(rows: unknown[][]): ImportRow[] {
  if (!rows.length || !rows.some(row => row.some(cell => String(cell ?? '').trim()))) throw new Error('Файл пуст. Заполните шаблон ведомости.');
  const aliases: Record<string, string> = { productid: 'productId', 'id товара': 'productId', quantity: 'quantity', 'количество': 'quantity', stagedate: 'stageDate', 'дата этапа': 'stageDate', 'название товара': 'name', 'единица': 'unit' };
  const header = rows[0].map(cell => aliases[String(cell ?? '').replace(/^\uFEFF/, '').trim().toLowerCase()]);
  if (header.some(cell => !cell) || new Set(header).size !== header.length || !['productId', 'quantity', 'stageDate'].every(key => header.includes(key))) {
    throw new Error('Неверный заголовок. Нужны столбцы: ID товара, Количество, Дата этапа (или productId, quantity, stageDate). Дополнительно: Название товара, Единица.');
  }
  const data = rows.slice(1).map((row, index) => ({ row, sourceLine: (row as unknown[] & { sourceLine?: number }).sourceLine ?? index + 2 })).filter(({ row }) => row.some(cell => String(cell ?? '').trim()));
  if (!data.length) throw new Error('В файле только заголовок. Добавьте строки материалов.');
  if (data.length > 200) throw new Error('Максимум 200 строк за один импорт.');
  return data.map(({ row, sourceLine }) => {
    const productId = String(row[header.indexOf('productId')] ?? '').trim().toLowerCase();
    const quantityText = String(row[header.indexOf('quantity')] ?? '').trim();
    const quantity = Number(quantityText); const stageDate = dateText(row[header.indexOf('stageDate')]);
    const validDate = !stageDate || (/^\d{4}-\d{2}-\d{2}$/.test(stageDate) && Number(stageDate.slice(0, 4)) > 0 && !Number.isNaN(Date.parse(`${stageDate}T00:00:00Z`)) && new Date(`${stageDate}T00:00:00Z`).toISOString().slice(0, 10) === stageDate);
    const error = row.length > header.length ? 'Лишние столбцы в строке' : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId) ? 'Укажите корректный ID товара' : !Number.isSafeInteger(quantity) || quantity <= 0 ? 'Количество должно быть положительным целым числом' : quantity > MAX_IMPORT_QUANTITY ? 'Количество не должно превышать 2 147 483 647' : !validDate ? 'Укажите существующую дату ГГГГ-ММ-ДД' : undefined;
    return { sourceLine, productId, quantity, quantityText, stageDate, error };
  });
}

export function importTemplate(product: Product): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const text = (value: string) => /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return '\uFEFFID товара;Количество;Дата этапа;Название товара;Единица\r\n' + [product.id, '1', '', text(product.name), text(product.unit)].map(quote).join(';') + '\r\n';
}
