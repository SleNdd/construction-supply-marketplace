import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Pool } from 'pg';
import { demoOrders, additionalProducts } from '../scripts/demo-catalog';
import { earliestDateInAstrakhan } from '../src/calendar-date';

const connection=process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test')) throw new Error('Нужна отдельная TEST_DATABASE_URL с именем *_test');
const admin=new Pool({connectionString:connection});
const id=(key:string)=>{
  const hex=createHash('md5').update(`objectmarket-demo-${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
async function run(script:string,url:string,success=true) {
  const child=spawn(process.execPath,['--import','tsx',script],{env:{...process.env,DATABASE_URL:url,DEMO_SEED:'true'},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const [code]=await once(child,'exit');
  if (success) assert.equal(code,0,output); else assert.notEqual(code,0,'ошибка должна прервать seed');
}
async function fingerprint(pool:Pool) {
  const tables=(await pool.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result:Record<string,string>={};
  for (const {tablename} of tables) {
    const rows=(await pool.query(`SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    result[tablename]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  assert.equal(tables.length,17);
  return result;
}
async function verify(pool:Pool) {
  const count=async(table:string)=>(await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  for (const [table,n] of Object.entries({users:6,suppliers:2,warehouses:2,categories:5,products:48,offers:96,projects:6,orders:12,order_items:21,deliveries:19})) assert.equal(await count(table),n,table);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM offers WHERE stock<0')).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM offers WHERE NOT active')).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM offers WHERE stock=0')).rows[0].n,1);
  const original=(await pool.query('SELECT product_id,quantity FROM project_items WHERE project_id=$1',[id('project-finishing')])).rows;
  assert.deepEqual(Object.fromEntries(original.map(row=>[row.product_id,row.quantity])),{[id('tile-beige-box')]:19,[id('adhesive')]:8,[id('paint-white')]:3});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM projects p,jsonb_array_elements(p.stages) stage WHERE (stage->>'date')::date<=$1::date",[earliestDateInAstrakhan(0)])).rows[0].n,0,'этапы будущие');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_items WHERE stage_date<=$1::date',[earliestDateInAstrakhan(0)])).rows[0].n,0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM orders o WHERE
    items_total_kopecks<>(SELECT sum(i.price_kopecks::bigint*i.quantity) FROM order_items i WHERE i.order_id=o.id)
    OR delivery_total_kopecks<>(SELECT sum(d.delivery_cost_kopecks) FROM deliveries d WHERE d.order_id=o.id)`)).rows[0].n,0,'суммы снимков');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM deliveries d WHERE delivery_cost_kopecks<>(SELECT max(f.delivery_cost_kopecks) FROM order_items i JOIN offers f ON f.id=i.offer_id WHERE i.order_id=d.order_id AND i.supplier_id=d.supplier_id)`)).rows[0].n,0,'доставка раз на поставщика');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM orders o WHERE
    status='paid' AND EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.status NOT IN ('pending','assigned'))
    OR status='delivered' AND EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.status<>'delivered')
    OR status='in_progress' AND (NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.status IN ('picked_up','in_transit','delivered')) OR NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.status<>'delivered'))
    OR status IN ('expired','cancelled') AND EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.status<>'cancelled')
    OR status='awaiting_payment'`)).rows[0].n,0,'согласованные статусы без живых unpaid');
  assert.deepEqual((await pool.query('SELECT DISTINCT status FROM deliveries ORDER BY status')).rows.map(row=>row.status),['assigned','cancelled','delivered','in_transit','pending','picked_up']);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM deliveries d LEFT JOIN users u ON u.id=d.driver_id WHERE (d.status IN ('pending','cancelled') AND d.driver_id IS NOT NULL) OR (d.status NOT IN ('pending','cancelled') AND (u.role IS DISTINCT FROM 'driver'))`)).rows[0].n,0,'права водителя');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM delivery_events e JOIN deliveries d ON d.id=e.delivery_id JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=e.actor_id WHERE e.actor_id IS DISTINCT FROM d.driver_id OR u.role<>'driver' OR e.created_at<o.created_at OR e.created_at>now()`)).rows[0].n,0,'роль и время событий');
  for (const row of (await pool.query(`SELECT d.status,array_agg(e.status ORDER BY e.created_at) FILTER(WHERE e.id IS NOT NULL) AS events FROM deliveries d LEFT JOIN delivery_events e ON e.delivery_id=d.id GROUP BY d.id`)).rows) {
    const expected:Record<string,string[]>={pending:[],assigned:[],cancelled:[],picked_up:['picked_up'],in_transit:['picked_up','in_transit'],delivered:['picked_up','in_transit','delivered']};
    assert.deepEqual(row.events ?? [],expected[row.status]);
  }
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM deliveries d WHERE route<>'[]'::jsonb OR departure_points<>(SELECT jsonb_agg(jsonb_build_object('warehouseId',w.id,'name',w.name,'address',w.address,'coordinates',CASE WHEN w.lon IS NULL OR w.lat IS NULL THEN NULL ELSE jsonb_build_array(w.lon,w.lat) END) ORDER BY w.id) FROM warehouses w WHERE w.id IN (SELECT f.warehouse_id FROM order_items i JOIN offers f ON f.id=i.offer_id WHERE i.order_id=d.order_id AND i.supplier_id=d.supplier_id))`)).rows[0].n,0,'реальные снимки склада и отсутствие выдуманного маршрута');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM orders WHERE
    destination_lon IS DISTINCT FROM CASE address WHEN 'Астрахань, ул. Савушкина, 6' THEN 48.057 WHEN 'Астрахань, ул. Адмиралтейская, 14' THEN 48.035 ELSE NULL END
    OR destination_lat IS DISTINCT FROM CASE address WHEN 'Астрахань, ул. Савушкина, 6' THEN 46.371 WHEN 'Астрахань, ул. Адмиралтейская, 14' THEN 46.351 ELSE NULL END`)).rows[0].n,0,'точные пары известных адресов, ручные адреса с null');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE project_id=$1 AND address='Астрахань, ул. Адмиралтейская, 14'",[id('project-bathroom')])).rows[0].n,3,'адрес трёх заказов санузла');
  assert.equal((await pool.query('SELECT address FROM projects WHERE id=$1',[id('project-bathroom')])).rows[0].address,'Астрахань, ул. Адмиралтейская, 14');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE status IN ('expired','cancelled') AND (reservation_expires_at IS NULL OR reservation_expires_at>now())")).rows[0].n,0,'закрытые резервы не продлеваются');
  const originals=['cement','plaster','adhesive','paint-white','paint-facade','tile-beige','tile-grey','board','plywood','wool','membrane','tile-beige-box','tile-grey-box'];
  const keys=[...originals,...additionalProducts.map(row=>row[0])];
  for (let index=0;index<keys.length;index++) for (let supplierIndex=0;supplierIndex<2;supplierIndex++) {
    const supplier=supplierIndex?'kaspiy':'volga', key=keys[index];
    const consumed=demoOrders.filter(order=>!order.terminal).flatMap(order=>order.items).filter(row=>row[0]===key && row[1]===supplier).reduce((sum,row)=>sum+row[2],0);
    const base=key==='xps' && supplier==='kaspiy'?0:40+index*3+supplierIndex*12;
    assert.equal((await pool.query('SELECT stock FROM offers WHERE id=$1',[id(`offer-${key}-${supplier}`)])).rows[0].stock,base-consumed,`однократное списание ${key}/${supplier}`);
  }
  console.log('PASS: 48 products / 96 offers / 6 projects / 12 orders; sums, supplier shipping, future stages, terminal reservations, stocks, role/event history, real warehouse snapshots and null address points');
}
async function fixture(kind:'fresh'|'concurrent'|'rollback') {
  const name=`seed_${kind}_${randomUUID().replaceAll('-','')}_test`;
  const url=new URL(connection!);url.pathname=`/${name}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const pool=new Pool({connectionString:url.toString()});
  try {
    await run('scripts/migrate.ts',url.toString());
    if (kind==='rollback') {
      await pool.query("ALTER TABLE deliveries ADD CONSTRAINT seed_test_failure CHECK (status<>'delivered')");
      const before=await fingerprint(pool);
      await run('scripts/seed.ts',url.toString(),false);
      assert.deepEqual(await fingerprint(pool),before,'вся транзакция откатилась после поздней ошибки');
      await pool.query('ALTER TABLE deliveries DROP CONSTRAINT seed_test_failure');
    }
    if (kind==='concurrent') await Promise.all([run('scripts/seed.ts',url.toString()),run('scripts/seed.ts',url.toString())]);
    else await run('scripts/seed.ts',url.toString());
    await verify(pool);
    await pool.query("UPDATE users SET name='Имя, изменённое владельцем' WHERE id=$1",[id('buyer')]);
    await pool.query('UPDATE offers SET stock=7,price_kopecks=12345,active=false WHERE id=$1',[id('offer-cement-volga')]);
    await pool.query("UPDATE products SET name='Название владельца' WHERE id=$1",[id('paint-white')]);
    const before=await fingerprint(pool);
    await run('scripts/seed.ts',url.toString());
    assert.deepEqual(await fingerprint(pool),before,'повтор сохраняет все 17 таблиц после пользовательских изменений');
    console.log(`PASS: ${kind}; repeat preserves 17 table fingerprints after custom stock, price, active, product and user names${kind==='rollback'?'; late failure rollback and recovery':''}${kind==='concurrent'?'; concurrent fresh seed serialized':''}`);
  } finally {
    await pool.end();await admin.query(`DROP DATABASE "${name}"`);
  }
}
async function main() {
  try {
    const selected=process.argv[2];
    if (selected && !['fresh','concurrent','rollback'].includes(selected)) throw new Error('Сценарий должен быть fresh, concurrent или rollback');
    for (const kind of ['fresh','concurrent','rollback'] as const) if (!selected || selected===kind) await fixture(kind);
  } finally { await admin.end(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
