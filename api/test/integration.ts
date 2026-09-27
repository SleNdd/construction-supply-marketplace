import assert from 'node:assert/strict';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const connection=process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL должен указывать на отдельную базу с именем *_test');
const port=4300+Math.floor(Math.random()*500);
const base=`http://127.0.0.1:${port}/api/v1`;
const env={...process.env,DATABASE_URL:connection,DEMO_SEED:'true',API_PORT:String(port),CORS_ORIGIN:'http://localhost:3000'};
const pool=new Pool({connectionString:connection});

function script(path:string,vars:NodeJS.ProcessEnv=env) {
  const result=spawnSync(process.execPath,['--import','tsx',path],{cwd:process.cwd(),env:vars,encoding:'utf8'});
  if (result.status!==0) throw new Error(`${path}: ${result.stderr||result.stdout}`);
}

async function request(path:string,method='GET',body?:unknown,cookie?:string,key?:string) {
  const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function buyer() {
  const unique=randomUUID().slice(0,8);
  const result=await request('/auth/register','POST',{name:`Покупатель ${unique}`,email:`buyer-${unique}@example.test`,password:'TestPass2026!'});
  assert.equal(result.status,201,JSON.stringify(result.data));
  return result.cookie!;
}

async function waitForServer(child:ChildProcess) {
  for (let attempt=0;attempt<300;attempt++) {
    if (child.exitCode!==null) throw new Error(`API exited: ${child.exitCode}`);
    try { if ((await fetch(base+'/health')).ok) return; } catch {}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error('API не запустился');
}

async function main() {
  script('scripts/migrate.ts');
  script('scripts/seed.ts');
  const noSeed=spawnSync(process.execPath,['--import','tsx','scripts/seed.ts'],{cwd:process.cwd(),env:{...env,DEMO_SEED:'false'},encoding:'utf8'});
  assert.notEqual(noSeed.status,0,'демосид должен требовать opt-in');
  const child=spawn(process.execPath,['dist/main.js'],{cwd:process.cwd(),env,stdio:['ignore','ignore','pipe']});
  let serverError=''; child.stderr?.on('data',(chunk)=>{serverError+=chunk.toString();});
  try {
    await waitForServer(child).catch((error)=>{throw new Error(`${error}: ${serverError}`);});
    const failedEmails=Array.from({length:40},()=>`absent-${randomUUID()}@example.test`);
    const failed=await Promise.all(failedEmails.map((email)=>request('/auth/login','POST',{email,password:'wrong'})));
    assert.ok(failed.every((result)=>result.status===401),'ошибки разных адресов не должны блокировать всех покупателей');
    assert.equal((await request('/auth/login','POST',{email:'buyer@example.test',password:'Demo2026!'})).status,201,'общий адрес прокси не блокирует вход');
    const a=await buyer(); const b=await buyer();
    const product=(await request('/products?q=Цемент')).data.items[0];
    const offerId=(await request(`/products/${product.id}`)).data.offers[0].id;
    const stock=Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock);
    const purchase={items:[{offerId,quantity:2}],address:'Астрахань, ул. Савушкина, 6'};
    assert.equal((await request('/orders','POST',purchase,a)).status,400,'ключ обязателен');
    const key=randomUUID();
    const first=await request('/orders','POST',purchase,a,key);
    assert.equal(first.status,201,JSON.stringify(first.data));
    const productId=(await pool.query<{product_id:string}>('SELECT product_id FROM offers WHERE id=$1',[offerId])).rows[0].product_id;
    const originalUnit=first.data.items[0].unit;
    await pool.query("UPDATE products SET unit='другая единица' WHERE id=$1",[productId]);
    assert.equal((await request(`/orders/${first.data.id}`,'GET',undefined,a)).data.items[0].unit,originalUnit,'история заказа хранит единицу измерения');
    await pool.query('UPDATE products SET unit=$1 WHERE id=$2',[originalUnit,productId]);
    const replay=await request('/orders','POST',purchase,a,key);
    assert.equal(replay.data.id,first.data.id);
    assert.equal((await request('/orders','POST',{...purchase,items:[{offerId,quantity:3}]},a,key)).status,409);
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock-2);
    assert.equal((await request(`/orders/${first.data.id}`, 'GET',undefined,b)).status,404,'чужой заказ скрыт');
    assert.equal((await request(`/orders/${first.data.id}/cancel`,'POST',undefined,b)).status,404,'чужой заказ нельзя отменить');
    const cancelled=await request(`/orders/${first.data.id}/cancel`,'POST',undefined,a);
    assert.equal(cancelled.data.status,'cancelled');
    assert.equal((await request(`/orders/${first.data.id}/cancel`,'POST',undefined,a)).data.status,'cancelled');
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock,'резерв возвращён ровно один раз');
    assert.equal((await request(`/orders/${first.data.id}/demo-payment`,'POST',undefined,a)).status,409);
    const paid=await request('/orders','POST',{...purchase,items:[{offerId,quantity:1}]},a,randomUUID());
    assert.equal(paid.status,201);
    assert.equal((await request(`/orders/${paid.data.id}/demo-payment`,'POST',undefined,a)).data.status,'paid');
    assert.equal((await request(`/orders/${paid.data.id}/cancel`,'POST',undefined,a)).status,409,'оплаченный заказ нельзя отменить');
    const expiring=await request('/orders','POST',{...purchase,items:[{offerId,quantity:1}]},a,randomUUID());
    assert.equal(expiring.status,201);
    await pool.query("UPDATE orders SET reservation_expires_at=now()-interval '1 second' WHERE id=$1",[expiring.data.id]);
    await request('/quotes','POST',purchase);
    assert.equal((await request(`/orders/${expiring.data.id}`,'GET',undefined,a)).data.status,'expired');
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock-1,'истёкший резерв восстановлен');
    const project=await request('/projects','POST',{name:'Свой объект',address:'Астрахань, ул. Савушкина, 6'},a);
    assert.equal((await request(`/projects/${project.data.id}`,'GET',undefined,b)).status,404,'чужой объект скрыт');
    const suffix=randomUUID().slice(0,8);
    const category=(await pool.query<{id:string}>('SELECT id FROM categories LIMIT 1')).rows[0].id;
    const supplier=(await pool.query<{id:string}>('SELECT id FROM suppliers LIMIT 1')).rows[0].id;
    const warehouse=(await pool.query<{id:string}>('SELECT id FROM warehouses WHERE supplier_id=$1 LIMIT 1',[supplier])).rows[0].id;
    const item=(await pool.query<{id:string}>('INSERT INTO products(category_id,slug,name,unit) VALUES($1,$2,$3,$4) RETURNING id',[category,`last-stock-${suffix}`,'Тестовый товар последнего остатка','шт.'])).rows[0].id;
    const lastOffer=(await pool.query<{id:string}>('INSERT INTO offers(product_id,supplier_id,warehouse_id,price_kopecks,stock,delivery_days,delivery_cost_kopecks) VALUES($1,$2,$3,100,1,1,0) RETURNING id',[item,supplier,warehouse])).rows[0].id;
    const lastPurchase={items:[{offerId:lastOffer,quantity:1}],address:'Астрахань, ул. Савушкина, 6'};
    const concurrent=await Promise.all([request('/orders','POST',lastPurchase,a,randomUUID()),request('/orders','POST',lastPurchase,b,randomUUID())]);
    assert.deepEqual(concurrent.map((r)=>r.status).sort(),[201,409]);
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[lastOffer])).rows[0].stock),0);
    const supplierOffers=(await pool.query<{id:string;supplier_id:string}>('SELECT id,supplier_id FROM offers WHERE stock>0 AND active=true ORDER BY supplier_id,id')).rows;
    const fromFirst=supplierOffers[0];
    const fromSecond=supplierOffers.find((row)=>row.supplier_id!==fromFirst.supplier_id);
    assert.ok(fromSecond,'для проверки поставок нужны два поставщика');
    const multi=await request('/orders','POST',{items:[{offerId:fromFirst.id,quantity:1},{offerId:fromSecond.id,quantity:1}],address:'Астрахань, ул. Савушкина, 6'},a,randomUUID());
    assert.equal(multi.status,201,JSON.stringify(multi.data));
    assert.equal(multi.data.deliveries.length,2);
    assert.equal((await request(`/orders/${multi.data.id}/demo-payment`,'POST',undefined,a)).status,201);
    const dispatcher=(await request('/auth/login','POST',{email:'dispatcher@example.test',password:'Demo2026!'})).cookie!;
    const driver=(await request('/auth/login','POST',{email:'driver@example.test',password:'Demo2026!'})).cookie!;
    const driverId=(await request('/dispatch/drivers','GET',undefined,dispatcher)).data[0].id;
    for (const delivery of multi.data.deliveries) {
      assert.equal((await request(`/dispatch/deliveries/${delivery.id}`,'PATCH',{driverId},dispatcher)).status,200);
      for (const status of ['picked_up','in_transit']) assert.equal((await request(`/driver/deliveries/${delivery.id}/events`,'POST',{status},driver)).status,201);
    }
    const finishes=await Promise.all(multi.data.deliveries.map((delivery: {id:string})=>request(`/driver/deliveries/${delivery.id}/events`,'POST',{status:'delivered'},driver)));
    assert.ok(finishes.every((result)=>result.status===201),JSON.stringify(finishes));
    assert.equal((await request(`/orders/${multi.data.id}`,'GET',undefined,a)).data.status,'delivered','заказ закрывается после параллельного завершения поставок');
    console.log('PASS: вход без общего IP-лимита, снимок единицы, идемпотентность, резерв, права, конкурентные заказы и поставки');
  } finally { child.kill(); await pool.end(); }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
