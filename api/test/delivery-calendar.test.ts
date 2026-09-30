import assert from 'node:assert/strict';
import test from 'node:test';
import { Db } from '../src/db';
import { CatalogController } from '../src/routes/catalog';
import { OrdersController } from '../src/routes/orders';

const offerId = '11111111-1111-1111-1111-111111111111';
const offer = { id: offerId, supplier_id: 'supplier', supplier_name: 'Поставщик', product_name: 'Цемент', unit: 'мешок', price_kopecks: 100, stock: 10, delivery_days: 2, delivery_cost_kopecks: 500, active: true };
const instants = [
  ['2026-09-30T19:59:59Z', '2026-10-02'],
  ['2026-09-30T20:00:00Z', '2026-10-03'],
  ['2026-12-31T19:59:59Z', '2027-01-02'],
  ['2026-12-31T20:00:00Z', '2027-01-03'],
  ['2028-02-28T20:00:00Z', '2028-03-02'],
];

test('карточка предложения и расчёт используют один календарь Астрахани', async context => {
  const db = {
    one: async () => ({ id: 'product', name: 'Цемент' }),
    rows: async () => [{ id: offerId, deliveryDays: 2 }],
    pool: { query: async () => ({ rows: [offer] }) },
    transaction: async (work: (client: unknown) => Promise<unknown>) => work({ query: async () => ({ rows: [] }) }),
  } as unknown as Db;
  for (const [instant, expected] of instants) {
    context.mock.timers.enable({ apis: ['Date'], now: Date.parse(instant) });
    try {
      const product = await new CatalogController(db).product('product');
      const quote = await new OrdersController(db).quote({ items: [{ offerId, quantity: 1 }], address: 'Астрахань, ул. Савушкина, 6', requestedDate: expected });
      assert.equal(product.offers[0].earliestDeliveryDate, expected, instant);
      assert.equal(quote.lines[0].earliestDeliveryDate, expected, instant);
      assert.deepEqual(quote.warnings, []);
    } finally {
      context.mock.timers.reset();
    }
  }
});
