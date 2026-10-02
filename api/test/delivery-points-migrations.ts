import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';

export async function deliveryPointsUpgrade(connection: string) {
  const admin = new Pool({connectionString:connection});
  const name = `delivery_points_upgrade_${randomUUID().replaceAll('-','')}_test`;
  const url = new URL(connection); url.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const pool = new Pool({connectionString:url.toString()});
  let child: ChildProcess | undefined;
  const run = (path: string) => {
    const result = spawnSync(process.execPath,['--import','tsx',path],{env:{...process.env,DATABASE_URL:url.toString(),DEMO_SEED:'true'},encoding:'utf8'});
    if (result.status!==0) throw new Error(result.stderr||result.stdout||`${path}: ${result.status}`);
  };
  try {
    await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const migration of readdirSync('migrations').filter(file=>file.endsWith('.sql') && file<'006').sort()) {
      await pool.query(readFileSync(`migrations/${migration}`,'utf8'));
      await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[migration]);
    }
    run('scripts/seed.ts');
    const buyer = (await pool.query("SELECT id FROM users WHERE email='buyer@example.test'")).rows[0].id;
    const offer = (await pool.query('SELECT o.id,o.supplier_id,o.price_kopecks,o.delivery_cost_kopecks,p.name,p.unit FROM offers o JOIN products p ON p.id=o.product_id WHERE stock>0 ORDER BY o.id LIMIT 1')).rows[0];
    const order = randomUUID(), delivery = randomUUID(), key = randomUUID();
    const body = {items:[{offerId:offer.id,quantity:1}],address:'Астрахань, Историческая, 1'};
    const hash = createHash('sha256').update(JSON.stringify({...body,requestedDate:null,projectId:null})).digest('hex');
    const historicalRoute = [[48.033,46.35],[48.055,46.37]];
    await pool.query("INSERT INTO orders(id,buyer_id,address,items_total_kopecks,delivery_total_kopecks,reservation_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",[order,buyer,body.address,offer.price_kopecks,offer.delivery_cost_kopecks]);
    await pool.query('INSERT INTO order_items(order_id,offer_id,supplier_id,product_name,unit,quantity,price_kopecks) VALUES($1,$2,$3,$4,$5,1,$6)',[order,offer.id,offer.supplier_id,offer.name,offer.unit,offer.price_kopecks]);
    await pool.query('UPDATE offers SET stock=stock-1 WHERE id=$1',[offer.id]);
    await pool.query('INSERT INTO deliveries(id,order_id,supplier_id,delivery_cost_kopecks,route) VALUES($1,$2,$3,$4,$5)',[delivery,order,offer.supplier_id,offer.delivery_cost_kopecks,JSON.stringify(historicalRoute)]);
    await pool.query('INSERT INTO idempotency_keys(buyer_id,key,request_hash,order_id) VALUES($1,$2,$3,$4)',[buyer,key,hash,order]);
    const tables = ['orders','deliveries','order_items','offers','idempotency_keys'];
    const snapshot = async (table:string) => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(row=>row.row);
    const before = new Map<string,any[]>();
    for (const table of tables) before.set(table,await snapshot(table));
    run('scripts/migrate.ts'); run('scripts/seed.ts');
    for (const table of tables) {
      const actual = (await snapshot(table)).map(row=>{
        if (table==='orders') { assert.equal(row.destination_lon,null); assert.equal(row.destination_lat,null); delete row.destination_lon; delete row.destination_lat; }
        if (table==='deliveries') { assert.deepEqual(row.departure_points,[]); delete row.departure_points; }
        return row;
      }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      assert.deepEqual(actual,before.get(table)!.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),`006 сохраняет исторические ${table}`);
    }
    const port = 7200+Math.floor(Math.random()*500), base = `http://127.0.0.1:${port}/api/v1`;
    child = spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:url.toString(),API_PORT:String(port),CORS_ORIGIN:'http://localhost:3000'},stdio:'ignore'});
    let ready = false;
    for (let attempt=0; attempt<300; attempt++) {
      if (child.exitCode!==null) throw new Error(`API exited: ${child.exitCode}`);
      try { if ((await fetch(`${base}/health`)).ok) {ready=true;break;} } catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready);
    const login = await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'buyer@example.test',password:'Demo2026!'})});
    assert.equal(login.status,201);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const state = async () => ({stock:(await pool.query('SELECT stock FROM offers WHERE id=$1',[offer.id])).rows[0].stock,orders:(await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n});
    const beforeRetry = await state();
    for (const retry of [body,{...body,destinationCoordinates:null}]) {
      const response = await fetch(`${base}/orders`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(retry)});
      assert.equal(response.status,201);
      const detail = await response.json() as any;
      assert.equal(detail.id,order); assert.equal(detail.destinationCoordinates,null);
      assert.deepEqual(detail.deliveries[0].departurePoints,[]); assert.deepEqual(detail.deliveries[0].route,historicalRoute);
      assert.deepEqual(await state(),beforeRetry,'старый хеш возвращает старый заказ без нового резерва');
    }
    const conflict = await fetch(`${base}/orders`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({...body,destinationCoordinates:[48,46]})});
    assert.equal(conflict.status,409); assert.deepEqual(await state(),beforeRetry);
    run('scripts/migrate.ts'); run('scripts/seed.ts');
    assert.deepEqual(await state(),beforeRetry,'повтор миграции и seed сохраняет резерв');
    console.log(`PASS: pre-006 upgrade, legacy hash omitted/null retry, old null/[] and route/history preserved; isolated fixture ${name}`);
  } finally {
    if (child && child.exitCode===null) { const exited=once(child,'exit'); child.kill(); await exited; }
    await pool.end(); await admin.end();
  }
}
