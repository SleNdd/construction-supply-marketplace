import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';

const connection=process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL должен указывать на отдельную базу *_test');
const adminPool=new Pool({connectionString:connection});
const id=(key:string)=>{
  const hex=createHash('md5').update(`objectmarket-demo-${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
function run(path:string,url:string) {
  const result=spawnSync(process.execPath,['--import','tsx',path],{env:{...process.env,DATABASE_URL:url,DEMO_SEED:'true'},encoding:'utf8'});
  if (result.status!==0) throw new Error(result.stderr||result.stdout||`${path}: ${result.status}`);
}
async function snapshot(pool:Pool,table:string) {
  return (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows.map(r=>r.row);
}
async function fixture(kind:'upgrade'|'fresh') {
  const name=`packaging_${kind}_${randomUUID().replaceAll('-','')}_test`;
  const url=new URL(connection!);url.pathname=`/${name}`;
  await adminPool.query(`CREATE DATABASE "${name}"`);
  const pool=new Pool({connectionString:url.toString()});
  let child:ChildProcess|undefined;
  try {
    if (kind==='upgrade') {
      await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const migration of readdirSync('migrations').filter(n=>n.endsWith('.sql') && n<'005').sort()) {
        await pool.query(readFileSync(`migrations/${migration}`,'utf8'));
        await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[migration]);
      }
      run('test/fixtures/legacy-seed.ts',url.toString());
      // Изменённые исходные параметры исключают автоматическое заполнение фасовки.
      await pool.query("UPDATE products SET specs='{}' WHERE id=$1",[id('paint-facade')]);
      await pool.query("UPDATE products SET specs='{}' WHERE id=$1",[id('tile-grey')]);
      const order=randomUUID();
      await pool.query("INSERT INTO orders(id,buyer_id,address,status,items_total_kopecks,delivery_total_kopecks,reservation_expires_at) VALUES($1,$2,'Астрахань, Тестовая, 1','awaiting_payment',257000,65000,now()+interval '30 minutes')",[order,id('buyer')]);
      await pool.query("INSERT INTO order_items(order_id,offer_id,supplier_id,product_name,unit,quantity,price_kopecks) VALUES($1,$2,$3,'Старый Песчаник','м²',2,128500)",[order,id('offer-tile-beige-volga'),id('volga')]);
      await pool.query('UPDATE offers SET stock=stock-2 WHERE id=$1',[id('offer-tile-beige-volga')]);
      await pool.query('INSERT INTO project_items(project_id,product_id,quantity) VALUES($1,$2,24)',[id('project-demo'),id('tile-beige')]);
      const tables=['offers','orders','order_items','project_items','deliveries','products'];
      const before=new Map<string,any[]>();
      for (const table of tables) before.set(table,await snapshot(pool,table));
      run('scripts/migrate.ts',url.toString()); run('scripts/seed.ts',url.toString());
      for (const table of tables) {
        const after=new Map((await snapshot(pool,table)).map(row=>[row.id,row]));
        for (const original of before.get(table)!) {
          const actual={...after.get(original.id)};
          if (table==='products') delete actual.packaging;
          assert.deepEqual(actual,original,`upgrade не меняет исторические ${table}`);
        }
      }
      assert.equal((await pool.query('SELECT packaging FROM products WHERE id=$1',[id('paint-facade')])).rows[0].packaging,null);
      assert.deepEqual((await pool.query('SELECT packaging FROM products WHERE id=$1',[id('paint-white')])).rows[0].packaging,{kind:'paint',packSizeL:10});
      const boxed=(await pool.query("SELECT o.stock,p.unit FROM offers o JOIN products p ON p.id=o.product_id WHERE p.slug IN ('tile-beige-box','tile-grey-box')")).rows;
      assert.equal(boxed.length,4); assert.ok(boxed.every(r=>r.stock===0 && r.unit==='коробка'));
      // Настоящая отмена через API после миграции возвращает резерв в прежние м².
      const port=6500+Math.floor(Math.random()*500);
      const base=`http://127.0.0.1:${port}/api/v1`;
      child=spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:url.toString(),API_PORT:String(port),CORS_ORIGIN:'http://localhost:3000'},stdio:'ignore'});
      let ready=false;
      for (let attempt=0;attempt<300;attempt++) {
        if (child.exitCode!==null) throw new Error(`API exited: ${child.exitCode}`);
        try { if ((await fetch(`${base}/health`)).ok) {ready=true;break;} } catch {}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(ready,'изолированное API запустилось');
      const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'buyer@example.test',password:'Demo2026!'})});
      assert.equal(login.status,201);
      const cookie=login.headers.get('set-cookie')!.split(';')[0];
      const cancel=await fetch(`${base}/orders/${order}/cancel`,{method:'POST',headers:{Cookie:cookie}});
      assert.equal(cancel.status,201);
      assert.equal((await cancel.json()).status,'cancelled');
      assert.equal((await pool.query('SELECT stock FROM offers WHERE id=$1',[id('offer-tile-beige-volga')])).rows[0].stock,55);
      assert.equal((await pool.query('SELECT stock FROM offers WHERE id=$1',[id('offer-tile-beige-box-volga')])).rows[0].stock,0);
    } else {
      run('scripts/migrate.ts',url.toString()); run('scripts/seed.ts',url.toString());
      const boxed=(await pool.query("SELECT o.stock,p.unit,p.packaging FROM offers o JOIN products p ON p.id=o.product_id WHERE p.slug IN ('tile-beige-box','tile-grey-box')")).rows;
      assert.equal(boxed.length,4); assert.ok(boxed.every(r=>r.stock>0 && r.unit==='коробка' && r.packaging.kind==='tiles'));
    }
    const before=await snapshot(pool,'offers'); const productsBefore=await snapshot(pool,'products');
    run('scripts/migrate.ts',url.toString()); run('scripts/seed.ts',url.toString());
    assert.deepEqual(await snapshot(pool,'offers'),before,`${kind}: повтор не добавляет/переписывает остатки`);
    assert.deepEqual(await snapshot(pool,'products'),productsBefore,`${kind}: повтор не меняет фасовку`);
    console.log(`PASS: ${kind}, migration/seed repeat, historical units/stocks/snapshots preserved`);
  } finally {
    if (child && child.exitCode===null) { const exited=once(child,'exit'); child.kill(); await exited; }
    await pool.end();
    await adminPool.query(`DROP DATABASE "${name}"`);
  }
}
async function main() { try { await fixture('upgrade'); await fixture('fresh'); } finally { await adminPool.end(); } }
main().catch(e=>{console.error(e);process.exitCode=1;});
