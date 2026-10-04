import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { tokenHash } from '../src/security';

type Requester = (path: string, method?: string, body?: unknown, cookie?: string, key?: string) => Promise<{status: number; data: any}>;

export async function deliveryLifecycleIntegration(request: Requester, pool: Pool, buyerCookie: string) {
  const database = (await pool.query<{name: string}>('SELECT current_database() AS name')).rows[0].name;
  assert.ok(database.endsWith('_test'), 'жизненный цикл доставки требует отдельную БД *_test');
  const identities = ['admin', 'supplier', 'dispatcher', 'driver'].map(role => ({
    role, id: randomUUID(), token: randomUUID(),
  }));
  const [admin, supplier, dispatcher, driver] = identities;
  const cookie = (identity: typeof admin) => `om_session=${identity.token}`;
  const categoryId = randomUUID(), supplierId = randomUUID(), warehouseId = randomUUID();
  const slug = `delivery-lifecycle-${randomUUID()}`;

  try {
    for (const identity of identities) {
      await pool.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',
        [identity.id, `Проверка доставки: ${identity.role}`, `${identity.id}@example.test`, 'unused', identity.role]);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [tokenHash(identity.token), identity.id]);
    }
    await pool.query('INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)', [categoryId, 'Проверка доставки', slug]);
    await pool.query('INSERT INTO suppliers(id,name,owner_id) VALUES($1,$2,$3)', [supplierId, 'Проверка доставки', supplier.id]);
    await pool.query('INSERT INTO warehouses(id,supplier_id,name,address) VALUES($1,$2,$3,$4)',
      [warehouseId, supplierId, 'Склад проверки доставки', 'Астрахань, Тестовая, 11']);
    const product = await request('/admin/products', 'POST', {
      categoryId, slug, name: 'Груз проверки доставки', unit: 'мешок',
    }, cookie(admin));
    assert.equal(product.status, 201, JSON.stringify(product.data));
    const offer = await request('/supplier/offers', 'POST', {
      productId: product.data.id, warehouseId, priceKopecks: 12000, stock: 10,
      deliveryDays: 0, deliveryCostKopecks: 1000,
    }, cookie(supplier));
    assert.equal(offer.status, 201, JSON.stringify(offer.data));
    const order = await request('/orders', 'POST', {
      items: [{offerId: offer.data.id, quantity: 2}], address: 'Астрахань, Тестовая, 12',
    }, buyerCookie, randomUUID());
    assert.equal(order.status, 201, JSON.stringify(order.data));
    assert.equal(order.data.status, 'awaiting_payment');
    assert.equal(order.data.deliveries.length, 1);
    const orderId: string = order.data.id, deliveryId: string = order.data.deliveries[0].id;

    // Один SQL-снимок включает все поля, а не только текущий статус.
    const saved = async () => (await pool.query(`SELECT
      (SELECT to_jsonb(o) FROM orders o WHERE o.id=$1) AS "order",
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM deliveries d WHERE d.order_id=$1) AS deliveries,
      COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id)
        FROM delivery_events e JOIN deliveries d ON d.id=e.delivery_id WHERE d.order_id=$1),'[]'::jsonb) AS events,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM order_items i WHERE i.order_id=$1) AS items,
      (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.buyer_id,k.key) FROM idempotency_keys k WHERE k.order_id=$1) AS keys,
      (SELECT to_jsonb(f) FROM offers f WHERE f.id=$2) AS offer`, [orderId, offer.data.id])).rows[0];
    const reserved = await saved();
    assert.equal(reserved.offer.stock, 8, 'заказ резервирует ровно две единицы собственного предложения');
    assert.equal(reserved.keys.length, 1);
    assert.deepEqual(reserved.events, []);

    const expectRefusal = async (path: string, method: string, body: unknown, session: string, code: string, label: string) => {
      const before = await saved();
      const result = await request(path, method, body, session);
      assert.equal(result.status, 409, `${label}: ${JSON.stringify(result.data)}`);
      assert.equal(result.data.code, code, label);
      assert.deepEqual(await saved(), before, `${label}: отказ сохраняет заказ, поставку, события, позиции, ключ и остаток`);
    };
    const assignment = {driverId: driver.id, scheduledDate: '2030-02-03'};
    const dispatchPath = `/dispatch/deliveries/${deliveryId}`;
    await expectRefusal(dispatchPath, 'PATCH', assignment, cookie(dispatcher), 'payment_required', 'T11: назначение до оплаты');
    const payment = await request(`/orders/${orderId}/demo-payment`, 'POST', undefined, buyerCookie);
    assert.equal(payment.status, 201, JSON.stringify(payment.data));
    assert.equal(payment.data.status, 'paid');
    const assigned = await request(dispatchPath, 'PATCH', assignment, cookie(dispatcher));
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    assert.equal(assigned.data.status, 'assigned');
    assert.equal(assigned.data.driverId, driver.id);
    assert.equal(assigned.data.scheduledDate, assignment.scheduledDate);
    const afterAssignment = await saved();
    assert.equal(afterAssignment.order.status, 'paid');
    assert.equal(afterAssignment.deliveries[0].status, 'assigned');
    assert.equal(afterAssignment.deliveries[0].driver_id, driver.id);
    assert.equal(afterAssignment.deliveries[0].scheduled_date, assignment.scheduledDate);
    assert.deepEqual(afterAssignment.events, [], 'назначение не создаёт водительское событие');
    for (const field of ['items', 'keys', 'offer']) assert.deepEqual(afterAssignment[field], reserved[field], `назначение сохраняет ${field}`);

    const eventPath = `/driver/deliveries/${deliveryId}/events`;
    const refuseStatuses = async (statuses: string[], current: string) => {
      for (const status of statuses) await expectRefusal(eventPath, 'POST', {status}, cookie(driver), 'invalid_status', `T12: ${current} → ${status}`);
    };
    const assertStage = async (before: Awaited<ReturnType<typeof saved>>, status: string, orderStatus: string) => {
      const after = await saved();
      assert.deepEqual(after.order, {...before.order, status: orderStatus}, 'этап меняет только статус заказа');
      assert.deepEqual(after.deliveries, before.deliveries.map((row: {id: string}) => row.id === deliveryId ? {...row, status} : row), 'этап меняет только статус своей поставки');
      assert.equal(after.events.length, before.events.length + 1, 'этап создаёт ровно одно событие');
      const added = after.events.filter((event: {id: string}) => !before.events.some((old: {id: string}) => old.id === event.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].delivery_id, deliveryId);
      assert.equal(added[0].actor_id, driver.id);
      assert.equal(added[0].status, status);
      assert.deepEqual(after.events.filter((event: {id: string}) => event.id !== added[0].id), before.events, 'прежние события сохраняются');
      for (const field of ['items', 'keys', 'offer']) assert.deepEqual(after[field], before[field], `этап сохраняет ${field}`);
    };

    await refuseStatuses(['pending', 'assigned', 'in_transit', 'delivered'], 'assigned');
    const beforePickup = await saved();
    const locked = await pool.connect();
    let completion: Promise<PromiseSettledResult<Awaited<ReturnType<Requester>>>[]> | undefined;
    let simultaneous: Awaited<ReturnType<Requester>>[] = [];
    try {
      await locked.query('BEGIN');
      await locked.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      completion = Promise.allSettled([
        request(eventPath, 'POST', {status: 'picked_up'}, cookie(driver)),
        request(eventPath, 'POST', {status: 'picked_up'}, cookie(driver)),
      ]);
      // Оба запроса должны дойти до блокировки заказа до освобождения строки.
      const deadline = Date.now() + 5000;
      let observed = false;
      while (Date.now() < deadline) {
        const waits = await pool.query(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query='SELECT status FROM orders WHERE id=$1 FOR UPDATE'`);
        if (waits.rowCount === 2) {
          observed = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(observed, 'за 5 секунд оба одинаковых события должны ожидать блокировку заказа');
      await locked.query('COMMIT');
      simultaneous = (await completion).map(result => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
    } finally {
      try {
        await locked.query('ROLLBACK');
      } finally {
        locked.release();
        if (completion) await completion;
      }
    }
    assert.deepEqual(simultaneous.map(result => result.status).sort(), [201, 409], 'одинаковые одновременные события имеют одного победителя');
    assert.equal(simultaneous.find(result => result.status === 409)!.data.code, 'invalid_status');
    await assertStage(beforePickup, 'picked_up', 'in_progress');
    await refuseStatuses(['pending', 'assigned', 'picked_up', 'delivered'], 'picked_up');
    for (const [status, orderStatus] of [['in_transit', 'in_progress'], ['delivered', 'delivered']]) {
      const before = await saved();
      const result = await request(eventPath, 'POST', {status}, cookie(driver));
      assert.equal(result.status, 201, JSON.stringify(result.data));
      assert.equal(result.data.status, status);
      await assertStage(before, status, orderStatus);
      await refuseStatuses(status === 'in_transit' ? ['pending', 'assigned', 'picked_up', 'in_transit'] : ['pending', 'assigned', 'picked_up', 'in_transit', 'delivered'], status);
    }
    const finished = await saved();
    assert.deepEqual(finished.events.map((event: {status: string}) => event.status), ['picked_up', 'in_transit', 'delivered']);
    const detail = await request(`/orders/${orderId}`, 'GET', undefined, buyerCookie);
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.status, 'delivered', 'разрешённый путь завершает заказ');
    console.log('PASS: доставка T11/T12 — оплата до назначения, запрет пропусков/повторов/возвратов, полные снимки отказов, один победитель параллельного события, завершение заказа');
  } finally {
    // Удаляем только собственную фикстуру, включая заказ при потерянном ответе API.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = (await client.query<{order_id: string}>('SELECT DISTINCT order_id FROM deliveries WHERE supplier_id=$1', [supplierId])).rows.map(row => row.order_id);
      await client.query('DELETE FROM delivery_events WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id=ANY($1::uuid[]))', [ids]);
      await client.query('DELETE FROM idempotency_keys WHERE order_id=ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM order_items WHERE order_id=ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM deliveries WHERE order_id=ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM orders WHERE id=ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM offers WHERE supplier_id=$1', [supplierId]);
      await client.query('DELETE FROM products WHERE category_id=$1', [categoryId]);
      await client.query('DELETE FROM warehouses WHERE supplier_id=$1', [supplierId]);
      await client.query('DELETE FROM suppliers WHERE id=$1', [supplierId]);
      await client.query('DELETE FROM categories WHERE id=$1', [categoryId]);
      await client.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [identities.map(identity => identity.id)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
