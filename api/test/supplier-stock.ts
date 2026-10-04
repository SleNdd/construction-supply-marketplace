import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { tokenHash } from '../src/security';

type Request = (
  path: string,
  method?: string,
  body?: unknown,
  cookie?: string,
  key?: string,
) => Promise<{ status: number; data: any }>;

export async function supplierStockIntegration(request: Request, pool: Pool, buyer: string) {
  const database = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]
    .name;
  assert.ok(database.endsWith('_test'), 'проверка остатков требует отдельную БД *_test');
  const suffix = randomUUID();
  const identities = [];
  for (const role of ['supplier', 'supplier', 'admin'] as const) {
    const token = randomUUID();
    const id = randomUUID();
    await pool.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [
      id,
      `Проверка ${role}`,
      `${id}@example.test`,
      'unused',
      role,
    ]);
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [tokenHash(token), id],
    );
    identities.push({ id, cookie: `om_session=${token}` });
  }
  const [owner, foreign, admin] = identities;
  const warehouses = [];
  for (const identity of [owner, foreign]) {
    const supplierId = randomUUID();
    const warehouseId = randomUUID();
    await pool.query('INSERT INTO suppliers(id,name,owner_id) VALUES($1,$2,$3)', [
      supplierId,
      `Поставщик ${identity.id}`,
      identity.id,
    ]);
    const name = `Склад ${identity.id}`;
    await pool.query('INSERT INTO warehouses(id,supplier_id,name,address) VALUES($1,$2,$3,$4)', [
      warehouseId,
      supplierId,
      name,
      'Астрахань, Тестовая, 1',
    ]);
    warehouses.push({ id: warehouseId, name });
  }
  const categoryId = (await pool.query('SELECT id FROM categories ORDER BY id LIMIT 1')).rows[0].id;
  const productId = randomUUID();
  await pool.query('INSERT INTO products(id,category_id,slug,name,unit) VALUES($1,$2,$3,$4,$5)', [
    productId,
    categoryId,
    `stock-${suffix}`,
    `Проверка остатка ${suffix}`,
    'мешок',
  ]);
  const createBody = {
    productId,
    warehouseId: warehouses[0].id,
    priceKopecks: 14500,
    stock: 20,
    deliveryDays: 1,
    deliveryCostKopecks: 1000,
  };
  for (const field of ['priceKopecks', 'stock', 'deliveryDays', 'deliveryCostKopecks']) {
    const invalid = await request(
      '/supplier/offers',
      'POST',
      { ...createBody, [field]: 2147483648 },
      owner.cookie,
    );
    assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
    assert.equal(invalid.data.code, 'invalid_input');
    assert.equal(
      (
        await pool.query('SELECT count(*)::integer AS count FROM offers WHERE product_id=$1', [
          productId,
        ])
      ).rows[0].count,
      0,
      'переполнение POST не создаёт предложение',
    );
  }
  const created = await request('/supplier/offers', 'POST', createBody, owner.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  const path = `/supplier/offers/${id}`;
  const saved = async () => (await pool.query('SELECT * FROM offers WHERE id=$1', [id])).rows[0];
  const patch = (body: unknown, cookie = owner.cookie) => request(path, 'PATCH', body, cookie);
  const expectError = (result: { status: number; data: any }, status: number, code: string) => {
    assert.equal(result.status, status, JSON.stringify(result.data));
    assert.equal(result.data.code, code);
  };
  const listed = await request('/supplier/offers', 'GET', undefined, owner.cookie);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.length, 1, 'список содержит только предложения владельца');
  assert.equal(listed.data[0].productUnit, 'мешок');
  assert.equal(listed.data[0].warehouseName, warehouses[0].name);

  const initial = await saved();
  for (const body of [
    { stock: 21 },
    { expectedStock: 20 },
    { priceKopecks: 15000, expectedStock: 20 },
    ...[null, -1, 1.5, '20', true, 2147483648, Number.MAX_SAFE_INTEGER].map((expectedStock) => ({
      stock: 21,
      expectedStock,
    })),
    ...[null, -1, 1.5, '20', 2147483648].map((stock) => ({ stock, expectedStock: 20 })),
    ...['priceKopecks', 'deliveryDays', 'deliveryCostKopecks'].map((field) => ({
      [field]: 2147483648,
    })),
  ]) {
    expectError(await patch(body), 400, 'invalid_input');
    assert.deepEqual(await saved(), initial, 'неверное тело не меняет ни одно поле');
  }
  expectError(await request(path, 'PATCH', { stock: 21, expectedStock: 20 }), 401, 'unauthorized');
  for (const cookie of [buyer, admin.cookie])
    expectError(await patch({ stock: 21, expectedStock: 20 }, cookie), 403, 'forbidden');
  const missing = await request(
    `/supplier/offers/${randomUUID()}`,
    'PATCH',
    { stock: 21, expectedStock: 20 },
    owner.cookie,
  );
  const forbidden = await patch({ stock: 21, expectedStock: 20 }, foreign.cookie);
  expectError(forbidden, 404, 'not_found');
  assert.deepEqual(forbidden, missing, 'чужое предложение не раскрывает наличие или остаток');
  assert.deepEqual(await saved(), initial);

  for (const [stock, expectedStock] of [
    [0, 20],
    [2147483647, 0],
    [20, 2147483647],
  ]) {
    const changed = await patch({ stock, expectedStock });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(changed.data.stock, stock);
  }
  const successfulBody = {
    stock: 30,
    expectedStock: 20,
    priceKopecks: 15000,
    deliveryDays: 2,
    deliveryCostKopecks: 1200,
    active: false,
  };
  assert.equal((await patch(successfulBody)).status, 200);
  const success = await saved();
  assert.deepEqual(
    [
      success.stock,
      success.price_kopecks,
      success.delivery_days,
      success.delivery_cost_kopecks,
      success.active,
    ],
    [30, 15000, 2, 1200, false],
  );
  expectError(await patch(successfulBody), 409, 'offer_stock_changed');
  assert.deepEqual(await saved(), success, 'повтор старого запроса не применяет изменения заново');
  assert.equal((await patch({ stock: 50, expectedStock: 30, active: true })).status, 200);
  const simultaneous = await Promise.all([
    patch({ stock: 51, expectedStock: 50, priceKopecks: 15100 }),
    patch({ stock: 52, expectedStock: 50, priceKopecks: 15200 }),
  ]);
  assert.deepEqual(
    simultaneous.map((result) => result.status).sort(),
    [200, 409],
    'один старый остаток позволяет только одну запись',
  );
  expectError(
    simultaneous.find((result) => result.status === 409)!,
    409,
    'offer_stock_changed',
  );
  const winner = simultaneous.find((result) => result.status === 200)!.data;
  assert.deepEqual(
    [Number((await saved()).stock), (await saved()).price_kopecks],
    [winner.stock, winner.price_kopecks],
  );
  const beforeLock = await saved();

  // Observe a real blocked UPDATE; elapsed time alone is not evidence of a row lock.
  const locked = await pool.connect();
  let pending: ReturnType<typeof patch> | undefined;
  try {
    await locked.query('BEGIN');
    const blocker = (await locked.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid;
    await locked.query('SELECT id FROM offers WHERE id=$1 FOR UPDATE', [id]);
    await locked.query('UPDATE offers SET stock=stock-2 WHERE id=$1', [id]);
    pending = patch({
      stock: winner.stock + 10,
      expectedStock: winner.stock,
      priceKopecks: 99999,
      deliveryDays: 8,
      deliveryCostKopecks: 9999,
      active: false,
    });
    const deadline = Date.now() + 5000;
    let observed = false;
    while (Date.now() < deadline) {
      const waits = await pool.query(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE 'UPDATE offers o SET%'",
        [blocker],
      );
      if (waits.rowCount) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(observed, 'PATCH действительно ждёт блокировку строки резерва');
    await locked.query('COMMIT');
    const conflict = await pending;
    expectError(conflict, 409, 'offer_stock_changed');
    assert.match(conflict.data.message, /Обновите/);
    assert.deepEqual(
      await saved(),
      { ...beforeLock, stock: winner.stock - 2 },
      'конфликт сохраняет только резерв отдельной транзакции',
    );
    const after = await saved();
    assert.deepEqual(
      [after.price_kopecks, after.delivery_days, after.delivery_cost_kopecks, after.active],
      [winner.price_kopecks, 2, 1200, true],
      'конфликт после ожидания не меняет цену, доставку и активность',
    );
  } finally {
    await locked.query('ROLLBACK');
    locked.release();
    if (pending) await pending;
  }

  const beforeOrder = await saved();
  const purchase = { items: [{ offerId: id, quantity: 3 }], address: 'Астрахань, Тестовая, 1' };
  const key = randomUUID();
  const order = await request('/orders', 'POST', purchase, buyer, key);
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal((await saved()).stock, beforeOrder.stock - 3, 'заказ резервирует остаток');
  assert.equal(order.data.items[0].unit, 'мешок');
  assert.equal(order.data.items[0].priceKopecks, beforeOrder.price_kopecks);
  assert.equal((await patch({ priceKopecks: 20000 })).status, 200);
  assert.equal((await saved()).stock, beforeOrder.stock - 3, 'PATCH цены сохраняет резерв');
  const reserved = await saved();
  expectError(
    await patch({
      stock: beforeOrder.stock + 10,
      expectedStock: beforeOrder.stock,
      priceKopecks: 30000,
    }),
    409,
    'offer_stock_changed',
  );
  assert.deepEqual(await saved(), reserved, 'смешанный устаревший PATCH отклоняется целиком');
  const retry = await request('/orders', 'POST', purchase, buyer, key);
  assert.equal(retry.status, 201);
  assert.deepEqual(
    retry.data,
    order.data,
    'повтор заказа сохраняет снимок цены и не резервирует снова',
  );
  assert.equal((await saved()).stock, reserved.stock);
  const detail = await request(`/orders/${order.data.id}`, 'GET', undefined, buyer);
  assert.deepEqual(detail.data.items, order.data.items, 'цена и единица заказа остаются снимком');
  assert.equal(
    (await request(`/orders/${order.data.id}/cancel`, 'POST', undefined, buyer)).status,
    201,
  );
  assert.equal(
    (await saved()).stock,
    beforeOrder.stock,
    'отмена освобождает ровно исходный резерв',
  );
  console.log(
    'PASS: supplier-stock — expectedStock validation/bounds, owner/roles/no disclosure, atomic mixed PATCH, one concurrent winner, observed row-lock wait and predicate recheck, price-only reserve preservation, order snapshots/retry/cancel',
  );
}
