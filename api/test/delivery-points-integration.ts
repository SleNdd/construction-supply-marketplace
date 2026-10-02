import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type Requester = (path: string, method?: string, body?: unknown, cookie?: string, key?: string) => Promise<{status: number; data: any}>;

export async function deliveryPointsIntegration(request: Requester, pool: Pool, buyer: string, otherBuyer: string) {
  const supplier = (await pool.query('SELECT supplier_id FROM warehouses ORDER BY id LIMIT 1')).rows[0].supplier_id;
  const category = (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0].id;
  const warehouses = [randomUUID(), randomUUID(), randomUUID()];
  const offers: string[] = [];
  for (const [index, warehouse] of warehouses.entries()) {
    await pool.query('INSERT INTO warehouses(id,supplier_id,name,address,lon,lat) VALUES($1,$2,$3,$4,$5,$6)',
      [warehouse,supplier,`Тестовый склад ${index}`,`Астрахань, Складская, ${index+1}`,index===2?'NaN':48+index/10,index===2?null:46+index/10]);
  }
  for (let index=0; index<4; index++) {
    const product = (await pool.query("INSERT INTO products(category_id,slug,name,unit) VALUES($1,$2,'Товар для проверки точек','шт.') RETURNING id",[category,`points-${randomUUID()}`])).rows[0].id;
    offers.push((await pool.query('INSERT INTO offers(product_id,supplier_id,warehouse_id,price_kopecks,stock,delivery_days,delivery_cost_kopecks) VALUES($1,$2,$3,100,30,0,$4) RETURNING id',[product,supplier,warehouses[index%3],1000+index*100])).rows[0].id);
  }
  const body = {items:offers.map(offerId=>({offerId,quantity:1})),address:'Астрахань, Складская, 1'};
  const point = [48.057,46.371];
  const stock = async () => (await pool.query('SELECT id,stock FROM offers WHERE id=ANY($1::uuid[]) ORDER BY id',[offers])).rows;
  const counts = async () => (await pool.query('SELECT (SELECT count(*)::int FROM orders) AS orders,(SELECT count(*)::int FROM deliveries) AS deliveries,(SELECT count(*)::int FROM idempotency_keys) AS keys')).rows[0];

  // Ошибка точки не запускает даже освобождение прежнего истёкшего резерва.
  const expires = await request('/orders','POST',body,buyer,randomUUID());
  assert.equal(expires.status,201);
  assert.equal(expires.data.destinationCoordinates,null);
  await pool.query("UPDATE orders SET reservation_expires_at=now()-interval '1 second' WHERE id=$1",[expires.data.id]);
  const beforeInvalid = {stock:await stock(),counts:await counts()};
  for (const destinationCoordinates of [[],[48],[48,46,1],['48',46],[48,'46'],[null,46],[181,46],[48,-91],{},false]) {
    const invalid = await request('/orders','POST',{...body,destinationCoordinates},buyer,randomUUID());
    assert.equal(invalid.status,400,JSON.stringify(invalid.data));
    assert.equal(invalid.data.code,'invalid_input');
    assert.deepEqual({stock:await stock(),counts:await counts()},beforeInvalid,'ошибочная точка не меняет заказы/остатки/ключи');
    assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[expires.data.id])).rows[0].status,'awaiting_payment');
  }
  // Нормальная операция сохраняет прежнюю обработку истечения резерва.
  assert.equal((await request(`/orders/${expires.data.id}`,'GET',undefined,buyer)).data.status,'expired');
  const beforeRepeat = {stock:await stock(),counts:await counts()};
  const key = randomUUID();
  const repeated = await Promise.all(Array.from({length:6},()=>request('/orders','POST',{...body,destinationCoordinates:point},buyer,key)));
  assert.ok(repeated.every(result=>result.status===201),JSON.stringify(repeated));
  const order = repeated[0].data;
  for (const result of repeated) assert.equal(result.data.id,order.id,'параллельный повтор создаёт один заказ');
  assert.deepEqual(order.destinationCoordinates,point);
  assert.equal(order.deliveries.length,1,'группировка по поставщику сохранена');
  assert.equal(order.deliveryTotalKopecks,1300,'точка не влияет на максимальную ставку поставщика');
  assert.deepEqual(order.deliveries[0].route,[],'новые заказы не получают вымышленную геометрию');
  const expected = warehouses.map((warehouseId,index)=>({warehouseId,name:`Тестовый склад ${index}`,address:`Астрахань, Складская, ${index+1}`,coordinates:index===2?null:[48+index/10,46+index/10]})).sort((a,b)=>a.warehouseId.localeCompare(b.warehouseId));
  assert.deepEqual(order.deliveries[0].departurePoints,expected,'все склады поставщика, один склад двух позиций только один раз');
  assert.deepEqual(await stock(),beforeRepeat.stock.map(row=>({...row,stock:row.stock-1})));
  assert.deepEqual(await counts(),{orders:beforeRepeat.counts.orders+1,deliveries:beforeRepeat.counts.deliveries+1,keys:beforeRepeat.counts.keys+1});
  const conflict = await request('/orders','POST',{...body,destinationCoordinates:[48.058,46.371]},buyer,key);
  assert.equal(conflict.status,409); assert.equal(conflict.data.code,'idempotency_conflict');
  assert.equal((await request('/orders','POST',body,buyer,key)).status,409,'удаление ранее сохранённой точки меняет тело');
  const afterRepeat = {stock:await stock(),counts:await counts()};
  assert.equal((await request('/orders','POST',{...body,destinationCoordinates:point},buyer,key)).data.id,order.id,'повтор после потерянного ответа');
  assert.deepEqual({stock:await stock(),counts:await counts()},afterRepeat);
  const contestedKey = randomUUID();
  const contested = await Promise.all([point,[48.058,46.371]].map(destinationCoordinates=>request('/orders','POST',{...body,destinationCoordinates},buyer,contestedKey)));
  assert.deepEqual(contested.map(result=>result.status).sort(),[201,409],'разные точки с одним ключом создают один заказ');
  const withoutKey = randomUUID();
  const withoutPoint = await request('/orders','POST',body,buyer,withoutKey);
  assert.equal(withoutPoint.status,201);
  assert.equal(withoutPoint.data.destinationCoordinates,null);
  assert.equal((await request('/orders','POST',{...body,destinationCoordinates:null},buyer,withoutKey)).data.id,withoutPoint.data.id,'null и отсутствие точки одинаковы');
  assert.equal(withoutPoint.data.totalKopecks,order.totalKopecks,'цена с точкой и без точки одинакова');

  await pool.query("UPDATE warehouses SET name='Изменено после покупки',address='Другой адрес',lon=49,lat=47 WHERE id=ANY($1::uuid[])",[warehouses]);
  const immutable = await request(`/orders/${order.id}`,'GET',undefined,buyer);
  assert.deepEqual(immutable.data.deliveries[0].departurePoints,expected,'изменение склада не переписывает снимок');
  assert.equal((await request(`/orders/${order.id}`,'GET',undefined,otherBuyer)).status,404,'точки не раскрывают чужой заказ');
  assert.equal((await request('/dispatch/deliveries','GET',undefined,buyer)).status,403);
  assert.equal((await request('/driver/deliveries','GET',undefined,buyer)).status,403);

  const dispatcher = (await request('/auth/login','POST',{email:'dispatcher@example.test',password:'Demo2026!'})) as {data:any;cookie?:string;status:number};
  const driver = (await request('/auth/login','POST',{email:'driver@example.test',password:'Demo2026!'})) as {data:any;cookie?:string;status:number};
  assert.ok(dispatcher.cookie && driver.cookie);
  const deliveryId = order.deliveries[0].id;
  const dispatchRow = (await request('/dispatch/deliveries','GET',undefined,dispatcher.cookie)).data.find((row:{id:string})=>row.id===deliveryId);
  assert.deepEqual(dispatchRow.departurePoints,expected); assert.deepEqual(dispatchRow.destinationCoordinates,point);
  assert.ok(!(await request('/driver/deliveries','GET',undefined,driver.cookie)).data.some((row:{id:string})=>row.id===deliveryId),'неназначенный рейс скрыт');
  const driverId = driver.data.user.id;
  assert.equal((await request(`/orders/${order.id}/demo-payment`,'POST',undefined,buyer)).status,201);
  assert.equal((await request(`/dispatch/deliveries/${deliveryId}`,'PATCH',{driverId,scheduledDate:null},dispatcher.cookie)).status,200);
  const driverRow = (await request('/driver/deliveries','GET',undefined,driver.cookie)).data.find((row:{id:string})=>row.id===deliveryId);
  assert.deepEqual(driverRow.departurePoints,expected); assert.deepEqual(driverRow.destinationCoordinates,point);
  // Второй сеанс с ролью driver проверяет изоляцию списков и событий.
  const otherDriver = randomUUID(), token = randomUUID();
  const { tokenHash } = await import('../src/security');
  await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Другой водитель',$2,'unused','driver')",[otherDriver,`driver-${otherDriver}@example.test`]);
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash(token),otherDriver]);
  const otherDriverCookie = `om_session=${token}`;
  assert.ok(!(await request('/driver/deliveries','GET',undefined,otherDriverCookie)).data.some((row:{id:string})=>row.id===deliveryId));
  assert.equal((await request(`/driver/deliveries/${deliveryId}/events`,'POST',{status:'picked_up'},otherDriverCookie)).status,404);

  // Инъекция отказа снимка после списания остатков: всё внутри транзакции откатывается.
  const rollbackKey = `points-rollback-${randomUUID()}`;
  const beforeFailure = {stock:await stock(),counts:await counts()};
  await pool.query("CREATE FUNCTION test_reject_departure_points() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated snapshot failure'; END $$");
  await pool.query('CREATE TRIGGER test_reject_departure_points BEFORE INSERT ON deliveries FOR EACH ROW EXECUTE FUNCTION test_reject_departure_points()');
  try {
    assert.equal((await request('/orders','POST',{...body,destinationCoordinates:point},buyer,rollbackKey)).status,500);
    assert.deepEqual({stock:await stock(),counts:await counts()},beforeFailure,'сбой доставки откатывает заказ, позиции, остатки и ключ');
  } finally {
    await pool.query('DROP TRIGGER test_reject_departure_points ON deliveries');
    await pool.query('DROP FUNCTION test_reject_departure_points()');
  }
  assert.equal((await request('/orders','POST',{...body,destinationCoordinates:point},buyer,rollbackKey)).status,201,'после отката ключ доступен для безопасного повтора');
  // Ограничения таблиц защищают прямую запись от непарных и неконечных точек.
  for (const [lon,lat] of [[48,null],[null,46],[181,46],[48,91],['NaN',46],['Infinity',46]]) {
    await assert.rejects(pool.query('UPDATE orders SET destination_lon=$1,destination_lat=$2 WHERE id=$3',[lon,lat,order.id]),(error:{code?:string})=>error.code==='23514');
  }
  for (const departurePoints of [{},[{}],[{...expected[0],coordinates:[181,46]}],[{...expected[0],coordinates:[48,91]}],[{...expected[0],coordinates:['48',46]}],[{...expected[0],coordinates:[48]}]]) {
    await assert.rejects(pool.query('UPDATE deliveries SET departure_points=$1 WHERE id=$2',[JSON.stringify(departurePoints),deliveryId]),(error:{code?:string})=>error.code==='23514');
  }
  console.log('PASS: точки доставки — строгая валидация до мутаций, параллельные повторы/конфликты, цена, все склады/снимок, права, DB constraints, откат и безопасный повтор');
}
