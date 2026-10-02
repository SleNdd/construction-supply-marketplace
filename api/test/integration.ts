import assert from 'node:assert/strict';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { packagingIntegration } from './packaging-integration';
import { deliveryPointsIntegration } from './delivery-points-integration';

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
  const text=await response.text();
  return {status:response.status,data:text?JSON.parse(text) as any:null,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function buyer() {
  const unique=randomUUID().slice(0,8);
  const result=await request('/auth/register','POST',{name:`Покупатель ${unique}`,email:`buyer-${unique}@example.test`,password:'TestPass2026!'});
  assert.equal(result.status,201,JSON.stringify(result.data));
  return result.cookie!;
}

function assertOrderMoney(order: Record<string,unknown>, quote: Record<string,unknown>, label: string) {
  for (const field of ['itemsTotalKopecks','deliveryTotalKopecks','totalKopecks']) {
    assert.equal(typeof order[field],'number',`${label}: ${field} — число JSON`);
    assert.ok(Number.isSafeInteger(order[field]) && Number(order[field])>=0,`${label}: ${field} — точные неотрицательные копейки`);
    assert.equal(order[field],quote[field],`${label}: ${field} совпадает с расчётом`);
  }
}

function assertCalendarDate(value: unknown, expected: string|null, label: string) {
  assert.equal(value,expected,`${label}: дата календаря передаётся как YYYY-MM-DD либо null`);
  if (value!==null) assert.match(String(value),/^\d{4}-\d{2}-\d{2}$/,`${label}: без времени и смещения часового пояса`);
}

async function orderMoneyBoundaries(cookie: string, adminCookie: string) {
  const user=(await request('/auth/me','GET',undefined,cookie)).data.user;
  const id=randomUUID();
  try {
    await pool.query("INSERT INTO orders(id,buyer_id,address,status,items_total_kopecks,delivery_total_kopecks) VALUES($1,$2,'Астрахань, тестовая сумма, 1','paid',0,0)",[id,user.id]);
    for (const [items,delivery] of [['0','0'],['2147483648','2147483649'],['9007199254740991','0'],['0','9007199254740991']]) {
      await pool.query('UPDATE orders SET items_total_kopecks=$1,delivery_total_kopecks=$2 WHERE id=$3',[items,delivery,id]);
      const expected={itemsTotalKopecks:Number(items),deliveryTotalKopecks:Number(delivery),totalKopecks:Number(BigInt(items)+BigInt(delivery))};
      const detail=await request(`/orders/${id}`,'GET',undefined,cookie);
      assert.equal(detail.status,200,JSON.stringify(detail.data));
      assertOrderMoney(detail.data,expected,'граница суммы: карточка');
      const list=await request('/orders','GET',undefined,cookie);
      assert.equal(list.status,200,JSON.stringify(list.data));
      assertOrderMoney(list.data.find((order:{id:string})=>order.id===id),expected,'граница суммы: список');
    }
    for (const [items,delivery] of [['9007199254740992','0'],['0','9007199254740992'],['9007199254740991','1'],['-1','2'],['2','-1']]) {
      await pool.query('UPDATE orders SET items_total_kopecks=$1,delivery_total_kopecks=$2 WHERE id=$3',[items,delivery,id]);
      for (const path of [`/orders/${id}`,'/orders']) {
        const invalid=await request(path,'GET',undefined,cookie);
        assert.equal(invalid.status,500,`${path}: ${items} + ${delivery}`);
        assert.equal(invalid.data.code,'invalid_order_amount');
      }
    }
    await pool.query('UPDATE orders SET items_total_kopecks=$1,delivery_total_kopecks=0 WHERE id=$2',['9007199254740993',id]);
    const summary=await request('/reports/summary','GET',undefined,adminCookie);
    assert.equal(summary.status,200,JSON.stringify(summary.data));
    const expected=(await pool.query<{total:string}>('SELECT sum(items_total_kopecks+delivery_total_kopecks)::text AS total FROM orders')).rows[0].total;
    assert.equal(typeof summary.data.orders.totalKopecks,'string','агрегат отчёта сохраняет строковый контракт');
    assert.equal(summary.data.orders.totalKopecks,expected,'отчёт сохраняет сумму больше MAX_SAFE_INTEGER без округления');
  } finally {
    await pool.query('DELETE FROM orders WHERE id=$1',[id]);
  }
}

async function waitForServer(child:ChildProcess) {
  for (let attempt=0;attempt<300;attempt++) {
    if (child.exitCode!==null) throw new Error(`API exited: ${child.exitCode}`);
    try { if ((await fetch(base+'/health')).ok) return; } catch {}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error('API не запустился');
}

async function catalogFilters() {
  const suffix=randomUUID().slice(0,8);
  const term=`Фильтр ${suffix}`;
  const categoryIds=[randomUUID(),randomUUID()];
  const ids=Array.from({length:6},()=>randomUUID());
  const warehouses=(await pool.query<{id:string;supplier_id:string}>('SELECT id,supplier_id FROM warehouses ORDER BY id LIMIT 2')).rows;
  assert.equal(warehouses.length,2,'для сравнения цен нужны два склада');
  try {
    for (let index=0;index<2;index++) await pool.query('INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)',[categoryIds[index],`${term} категория ${index}`,`filter-${suffix}-${index}`]);
    for (let index=0;index<ids.length;index++) await pool.query('INSERT INTO products(id,category_id,slug,name,unit) VALUES($1,$2,$3,$4,$5)',[ids[index],categoryIds[index===5?1:0],`filter-${suffix}-${index}`,`${term} ${index}`,'шт.']);
    const offer=async (index:number,price:number,stock:number,active=true,warehouseIndex=0)=>{
      const warehouse=warehouses[warehouseIndex];
      await pool.query('INSERT INTO offers(product_id,supplier_id,warehouse_id,price_kopecks,stock,delivery_days,delivery_cost_kopecks,active) VALUES($1,$2,$3,$4,$5,1,0,$6)',[ids[index],warehouse.supplier_id,warehouse.id,price,stock,active]);
    };
    await offer(0,100,0); await offer(0,300,5,true,1);
    await offer(1,200,5); await offer(2,150,0); await offer(3,50,5,false); await offer(5,250,5);
    const get=async (filters:Record<string,string>={})=>{
      const result=await request(`/products?${new URLSearchParams({q:term,category:categoryIds[0],limit:'100',...filters})}`);
      assert.equal(result.status,200,JSON.stringify(result.data));
      return result.data as {items:Array<{id:string;priceFromKopecks:number|null}>;page:number;total:number};
    };
    const baseline=await get({sort:'price_asc'});
    assert.equal(baseline.total,5,'q и category исключают товар из другой категории');
    assert.deepEqual(baseline.items.map(row=>row.priceFromKopecks),[100,150,200,null,null],'активное предложение без остатка участвует в цене, неактивное — нет');
    assert.deepEqual(await get({inStock:'false',sort:'price_asc'}),baseline,'false сохраняет товары без доступного остатка');
    const range=await get({minPriceKopecks:'100',maxPriceKopecks:'200',sort:'price_desc'});
    assert.equal(range.total,3);
    assert.deepEqual(range.items.map(row=>row.priceFromKopecks),[200,150,100],'границы включены, цена — минимум предложений');
    assert.deepEqual((await get({minPriceKopecks:'100',maxPriceKopecks:'100'})).items.map(row=>row.id),[ids[0]],'равные границы допустимы');
    assert.equal((await get({minPriceKopecks:'250'})).total,0,'дорогое предложение не подменяет минимум товара');
    assert.equal((await get({maxPriceKopecks:'150'})).total,2,'верхняя граница без нижней');
    assert.equal((await get({minPriceKopecks:'0',maxPriceKopecks:'2147483647'})).total,3,'нулевая и предельная границы допустимы, товары без активной цены исключены');
    assert.equal((await get({maxPriceKopecks:'0'})).total,0);
    const stocked=await get({inStock:'true',sort:'price_asc'});
    assert.equal(stocked.total,2,'только активные предложения с положительным остатком');
    assert.deepEqual(stocked.items.map(row=>[row.id,row.priceFromKopecks]),[[ids[1],200],[ids[0],300]],'наличие меняет минимальную цену и порядок');
    assert.deepEqual((await get({inStock:'true',sort:'price_desc'})).items.map(row=>row.id),[ids[0],ids[1]]);
    assert.deepEqual((await get({inStock:'true',minPriceKopecks:'250',maxPriceKopecks:'300'})).items.map(row=>row.id),[ids[0]],'диапазон применён к минимальной цене в наличии');
    assert.equal((await get({inStock:'true',maxPriceKopecks:'150'})).total,0);
    const first=await get({inStock:'true',minPriceKopecks:'200',sort:'price_asc',limit:'1'});
    const second=await get({inStock:'true',minPriceKopecks:'200',sort:'price_asc',limit:'1',page:'2'});
    const beyond=await get({inStock:'true',minPriceKopecks:'200',sort:'price_asc',limit:'1',page:'3'});
    assert.deepEqual([first.total,second.total,beyond.total],[2,2,2],'total учитывает фильтры до пагинации');
    assert.deepEqual([first.items[0].id,second.items[0].id],[ids[1],ids[0]]);
    assert.equal(beyond.items.length,0);
    assert.equal(beyond.page,3);
    assert.deepEqual((await get({category:`filter-${suffix}-1`,inStock:'true',minPriceKopecks:'250'})).items.map(row=>row.id),[ids[5]],'категория по slug сочетается с поиском и ценой');
    assert.equal((await get({q:`${term} отсутствует`,inStock:'true'})).total,0);
    for (const name of ['minPriceKopecks','maxPriceKopecks']) {
      for (const value of ['','-1','1.5','1e2','NaN','Infinity','2147483648','9007199254740992',' 100','+100']) {
        const invalid=await request(`/products?${new URLSearchParams({[name]:value})}`);
        assert.equal(invalid.status,400,`${name}=${value}`);
        assert.equal(invalid.data.code,'invalid_input');
      }
    }
    for (const query of ['minPriceKopecks=200&maxPriceKopecks=100','inStock=','inStock=1','inStock=True','inStock=yes','minPriceKopecks=1&minPriceKopecks=2','maxPriceKopecks=1&maxPriceKopecks=2','inStock=true&inStock=false','sort=__proto__']) {
      const invalid=await request(`/products?${query}`);
      assert.equal(invalid.status,400,query);
      assert.equal(invalid.data.code,'invalid_input');
    }
  } finally {
    await pool.query('DELETE FROM offers WHERE product_id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM products WHERE id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM categories WHERE id=ANY($1::uuid[])',[categoryIds]);
  }
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
    await catalogFilters();
    const failedEmails=Array.from({length:40},()=>`absent-${randomUUID()}@example.test`);
    const failed=await Promise.all(failedEmails.map((email)=>request('/auth/login','POST',{email,password:'wrong'})));
    assert.ok(failed.every((result)=>result.status===401),'ошибки разных адресов не должны блокировать всех покупателей');
    assert.equal((await request('/auth/login','POST',{email:'buyer@example.test',password:'Demo2026!'})).status,201,'общий адрес прокси не блокирует вход');
    const a=await buyer(); const b=await buyer();
    const cheapFirst=await request('/products?sort=price_asc&limit=100');
    const expensiveFirst=await request('/products?sort=price_desc&limit=100');
    assert.equal(cheapFirst.status,200,JSON.stringify(cheapFirst.data));
    assert.equal(expensiveFirst.status,200,JSON.stringify(expensiveFirst.data));
    const prices=(rows:Array<{priceFromKopecks:number|null}>)=>rows.map(row=>row.priceFromKopecks).filter((value):value is number=>value!==null);
    const ascending=prices(cheapFirst.data.items);
    const descending=prices(expensiveFirst.data.items);
    assert.ok(ascending.length>1 && new Set(ascending).size>1,'для проверки сортировки нужны товары с разными ценами');
    assert.equal(descending.length,ascending.length,'обе сортировки возвращают одинаковый набор цен');
    assert.deepEqual(cheapFirst.data.items.map((row:{id:string})=>row.id).sort(),expensiveFirst.data.items.map((row:{id:string})=>row.id).sort(),'сортировка не меняет набор товаров');
    assert.deepEqual(ascending,[...ascending].sort((left,right)=>left-right),'цены по возрастанию');
    assert.deepEqual(descending,[...descending].sort((left,right)=>right-left),'цены по убыванию');
    const product=(await request('/products?q=Цемент')).data.items[0];
    assert.equal(typeof product.categoryId,'string','каталог возвращает ID категории для редактирования');
    const adminLogin=await request('/auth/login','POST',{email:'admin@example.test',password:'Demo2026!'});
    assert.equal(adminLogin.status,201);
    await orderMoneyBoundaries(a,adminLogin.cookie!);
    await packagingIntegration(request,pool,a,b,adminLogin.cookie!);
    await deliveryPointsIntegration(request,pool,a,b);
    const withoutOffer=await request('/admin/products','POST',{categoryId:product.categoryId,slug:'test-without-offer',name:'Товар без предложения',unit:'шт.'},adminLogin.cookie);
    assert.equal(withoutOffer.status,201,JSON.stringify(withoutOffer.data));
    for(const direction of ['price_asc','price_desc']) {
      const sorted=await request(`/products?sort=${direction}&limit=100`);
      assert.equal(sorted.status,200);
      assert.equal(sorted.data.items.at(-1).id,withoutOffer.data.id,'товар без цены находится после товаров с ценой');
      assert.equal(sorted.data.items.at(-1).priceFromKopecks,null);
    }
    await pool.query('DELETE FROM products WHERE id=$1',[withoutOffer.data.id]);
    assert.equal((await request(`/admin/products/${product.id}`,'PATCH',{description:''},adminLogin.cookie)).status,200,'администратор может очистить описание');
    assert.equal((await request(`/products/${product.id}`)).data.description,'');
    assert.equal((await request(`/admin/products/${product.id}`,'PATCH',{description:product.description},adminLogin.cookie)).status,200);
    const offerId=(await request(`/products/${product.id}`)).data.offers[0].id;
    const stock=Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock);
    const purchase={items:[{offerId,quantity:2}],address:'Астрахань, ул. Савушкина, 6'};
    const ordersBeforeInvalidDate=(await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
    for (const path of ['/quotes','/orders']) {
      const invalid=await request(path,'POST',{...purchase,requestedDate:'0000-01-01'},a,randomUUID());
      assert.equal(invalid.status,400,JSON.stringify(invalid.data));
      assert.equal(invalid.data.code,'invalid_input');
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,ordersBeforeInvalidDate,'год 0000 не создаёт заказ');
    const quote=await request('/quotes','POST',purchase);
    assert.equal(quote.status,201,JSON.stringify(quote.data));
    assert.equal((await request('/orders','POST',purchase,a)).status,400,'ключ обязателен');
    const key=randomUUID();
    const first=await request('/orders','POST',purchase,a,key);
    assert.equal(first.status,201,JSON.stringify(first.data));
    assertOrderMoney(first.data,quote.data,'создание заказа');
    const orderDetail=await request(`/orders/${first.data.id}`,'GET',undefined,a);
    assert.equal(orderDetail.status,200);
    assertOrderMoney(orderDetail.data,quote.data,'карточка заказа');
    assertCalendarDate(orderDetail.data.requestedDate,null,'карточка заказа без запрошенной даты');
    const orderList=await request('/orders','GET',undefined,a);
    assert.equal(orderList.status,200);
    assertOrderMoney(orderList.data.find((order:{id:string})=>order.id===first.data.id),quote.data,'список заказов');
    assertCalendarDate(orderList.data.find((order:{id:string})=>order.id===first.data.id).requestedDate,null,'список заказов без запрошенной даты');
    const productId=(await pool.query<{product_id:string}>('SELECT product_id FROM offers WHERE id=$1',[offerId])).rows[0].product_id;
    const originalUnit=first.data.items[0].unit;
    await pool.query("UPDATE products SET unit='другая единица' WHERE id=$1",[productId]);
    assert.equal((await request(`/orders/${first.data.id}`,'GET',undefined,a)).data.items[0].unit,originalUnit,'история заказа хранит единицу измерения');
    await pool.query('UPDATE products SET unit=$1 WHERE id=$2',[originalUnit,productId]);
    const replay=await request('/orders','POST',purchase,a,key);
    assert.equal(replay.status,201,JSON.stringify(replay.data));
    assert.equal(replay.data.id,first.data.id);
    assertOrderMoney(replay.data,quote.data,'повтор создания заказа');
    assert.equal((await request('/orders','POST',{...purchase,items:[{offerId,quantity:3}]},a,key)).status,409);
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock-2);
    assert.equal((await request(`/orders/${first.data.id}`, 'GET',undefined,b)).status,404,'чужой заказ скрыт');
    assert.equal((await request(`/orders/${first.data.id}/cancel`,'POST',undefined,b)).status,404,'чужой заказ нельзя отменить');
    const cancelled=await request(`/orders/${first.data.id}/cancel`,'POST',undefined,a);
    assert.equal(cancelled.status,201,JSON.stringify(cancelled.data));
    assert.equal(cancelled.data.status,'cancelled');
    assertOrderMoney(cancelled.data,quote.data,'отмена заказа');
    const cancelledAgain=await request(`/orders/${first.data.id}/cancel`,'POST',undefined,a);
    assert.equal(cancelledAgain.data.status,'cancelled');
    assertOrderMoney(cancelledAgain.data,quote.data,'повтор отмены заказа');
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock,'резерв возвращён ровно один раз');
    assert.equal((await request(`/orders/${first.data.id}/demo-payment`,'POST',undefined,a)).status,409);
    const paidPurchase={...purchase,items:[{offerId,quantity:1}]};
    const paidQuote=await request('/quotes','POST',paidPurchase);
    assert.equal(paidQuote.status,201);
    const paid=await request('/orders','POST',paidPurchase,a,randomUUID());
    assert.equal(paid.status,201);
    assertOrderMoney(paid.data,paidQuote.data,'создание оплачиваемого заказа');
    for (let attempt=0;attempt<2;attempt++) {
      const payment=await request(`/orders/${paid.data.id}/demo-payment`,'POST',undefined,a);
      assert.equal(payment.status,201,JSON.stringify(payment.data));
      assert.equal(payment.data.status,'paid');
      assertOrderMoney(payment.data,paidQuote.data,'оплата и её повтор');
    }
    assert.equal((await request(`/orders/${paid.data.id}/cancel`,'POST',undefined,a)).status,409,'оплаченный заказ нельзя отменить');
    const expiring=await request('/orders','POST',{...purchase,items:[{offerId,quantity:1}]},a,randomUUID());
    assert.equal(expiring.status,201);
    await pool.query("UPDATE orders SET reservation_expires_at=now()-interval '1 second' WHERE id=$1",[expiring.data.id]);
    await request('/quotes','POST',purchase);
    assert.equal((await request(`/orders/${expiring.data.id}`,'GET',undefined,a)).data.status,'expired');
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock-1,'истёкший резерв восстановлен');
    const project=await request('/projects','POST',{name:'Свой объект',address:'Астрахань, ул. Савушкина, 6'},a);
    assert.equal((await request(`/projects/${project.data.id}`,'GET',undefined,b)).status,404,'чужой объект скрыт');
    const listBefore=await request('/projects','GET',undefined,a);
    assert.equal(listBefore.data.find((entry:{id:string})=>entry.id===project.data.id).itemCount,0);
    const projectItem=await request(`/projects/${project.data.id}/items`,'POST',{productId,quantity:2,stageDate:'2026-10-01'},a);
    assert.equal(projectItem.status,201,JSON.stringify(projectItem.data));
    const projectBefore=await request(`/projects/${project.data.id}`,'GET',undefined,a);
    assert.equal(projectBefore.status,200);
    const foreignEdit=await request(`/projects/${project.data.id}`,'PATCH',{name:'Чужое название',address:'Чужой адрес'},b);
    assert.equal(foreignEdit.status,404,'чужой объект нельзя изменить');
    const projectAfter=await request(`/projects/${project.data.id}`,'GET',undefined,a);
    assert.equal(projectAfter.status,200);
    assert.deepEqual(projectAfter.data,projectBefore.data,'чужой PATCH сохраняет имя, адрес и позиции объекта владельца');
    const itemPath=`/projects/${project.data.id}/items/${projectItem.data.id}`;
    const itemsPath=`/projects/${project.data.id}/items`;
    const savedItems=async()=> (await pool.query('SELECT id,quantity,stage_date::text FROM project_items WHERE project_id=$1 ORDER BY id',[project.data.id])).rows;
    const beforeInvalid=await savedItems();
    for (const quantity of [2147483648,Number.MAX_SAFE_INTEGER]) {
      for (const [path,method,body] of [[itemsPath,'POST',{productId,quantity}],[itemPath,'PATCH',{quantity,stageDate:'2028-02-29'}]] as const) {
        const invalid=await request(path,method,body,a);
        assert.equal(invalid.status,400,JSON.stringify(invalid.data));
        assert.equal(invalid.data.code,'invalid_input');
        assert.deepEqual(await savedItems(),beforeInvalid,'переполнение не добавляет и не изменяет потребность');
      }
    }
    for (const stageDate of ['0000-01-01','0000-02-29','1900-02-29','2026-02-30']) {
      for (const [path,method,body] of [[itemsPath,'POST',{productId,quantity:1,stageDate}],[itemPath,'PATCH',{quantity:3,stageDate}]] as const) {
        const invalid=await request(path,method,body,a);
        assert.equal(invalid.status,400,JSON.stringify(invalid.data));
        assert.equal(invalid.data.code,'invalid_input');
        assert.deepEqual(await savedItems(),beforeInvalid,'ошибочная дата не меняет потребность');
      }
    }
    const boundary=await request(itemsPath,'POST',{productId,quantity:2147483647,stageDate:'2028-02-29'},a);
    assert.equal(boundary.status,201,JSON.stringify(boundary.data));
    assert.equal(boundary.data.quantity,2147483647);
    assert.equal(boundary.data.stageDate,'2028-02-29');
    assert.equal((await request(`${itemsPath}/${boundary.data.id}`,'DELETE',undefined,a)).status,204);
    const patchedBoundary=await request(itemPath,'PATCH',{quantity:2147483647,stageDate:'2028-02-29'},a);
    assert.equal(patchedBoundary.status,200,JSON.stringify(patchedBoundary.data));
    assert.equal(patchedBoundary.data.quantity,2147483647);
    assert.equal(patchedBoundary.data.stageDate,'2028-02-29');
    assert.equal((await savedItems())[0].quantity,2147483647,'граница сохраняется в PostgreSQL');
    assert.equal((await request(itemPath,'PATCH',{quantity:2,stageDate:'2026-10-01'},a)).status,200);
    assert.equal((await request('/projects','GET',undefined,a)).data.find((entry:{id:string})=>entry.id===project.data.id).itemCount,1);
    assert.equal((await request(itemPath,'PATCH',{quantity:3},b)).status,404,'чужую позицию нельзя изменить');
    assert.equal((await request(itemPath,'PATCH',{productId},b)).status,404,'чужая позиция скрыта и при ошибочном теле');
    assert.equal((await request(itemPath,'DELETE',undefined,b)).status,404,'чужую позицию нельзя удалить');
    assert.equal((await request(itemPath,'PATCH',{productId},a)).status,400,'товар позиции нельзя заменить');
    assert.equal((await request(itemPath,'PATCH',{quantity:0},a)).status,400);
    assert.equal((await request(itemPath,'PATCH',{stageDate:'2026-02-30'},a)).status,400);
    const editedItem=await request(itemPath,'PATCH',{quantity:4,stageDate:'2026-11-02'},a);
    assert.equal(editedItem.status,200,JSON.stringify(editedItem.data));
    assert.equal(editedItem.data.quantity,4);
    assert.equal(editedItem.data.stageDate,'2026-11-02');
    assert.equal((await request(itemPath,'PATCH',{stageDate:null},a)).data.stageDate,null,'дату можно очистить');
    assert.equal((await request(`/projects/${project.data.id}`,'GET',undefined,a)).data.items[0].quantity,4);
    assert.equal((await request(itemPath,'DELETE',undefined,a)).status,204);
    assert.equal((await request(itemPath,'DELETE',undefined,a)).status,404,'повторное удаление не меняет данные');
    assert.equal((await request('/projects','GET',undefined,a)).data.find((entry:{id:string})=>entry.id===project.data.id).itemCount,0);
    assert.equal(Number((await pool.query<{stock:number}>('SELECT stock FROM offers WHERE id=$1',[offerId])).rows[0].stock),stock-1,'изменение потребности не резервирует товар');
    assert.equal((await request(`/orders/${paid.data.id}`,'GET',undefined,a)).data.status,'paid','редактирование потребности не меняет заказ');
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
    const requestedDate='2030-01-02';
    const multi=await request('/orders','POST',{items:[{offerId:fromFirst.id,quantity:1},{offerId:fromSecond.id,quantity:1}],address:'Астрахань, ул. Савушкина, 6',requestedDate},a,randomUUID());
    assert.equal(multi.status,201,JSON.stringify(multi.data));
    assert.equal(multi.data.deliveries.length,2);
    const requestedDetail=await request(`/orders/${multi.data.id}`,'GET',undefined,a);
    assert.equal(requestedDetail.status,200,JSON.stringify(requestedDetail.data));
    assertCalendarDate(requestedDetail.data.requestedDate,requestedDate,'карточка заказа с запрошенной датой');
    const requestedList=await request('/orders','GET',undefined,a);
    assert.equal(requestedList.status,200,JSON.stringify(requestedList.data));
    assertCalendarDate(requestedList.data.find((order:{id:string})=>order.id===multi.data.id).requestedDate,requestedDate,'список заказов с запрошенной датой');
    assert.equal((await request(`/orders/${multi.data.id}/demo-payment`,'POST',undefined,a)).status,201);
    const dispatcher=(await request('/auth/login','POST',{email:'dispatcher@example.test',password:'Demo2026!'})).cookie!;
    const driver=(await request('/auth/login','POST',{email:'driver@example.test',password:'Demo2026!'})).cookie!;
    const driverId=(await request('/dispatch/drivers','GET',undefined,dispatcher)).data[0].id;
    const dispatchBefore=await request('/dispatch/deliveries','GET',undefined,dispatcher);
    assert.equal(dispatchBefore.status,200,JSON.stringify(dispatchBefore.data));
    for (const delivery of multi.data.deliveries) {
      const pending=dispatchBefore.data.find((row:{id:string})=>row.id===delivery.id);
      assert.ok(pending,`рейс ${delivery.id} присутствует в диспетчерском списке`);
      assertCalendarDate(pending.scheduledDate,null,'рейс до назначения');
    }
    const scheduledDates=['2030-02-03',null] as const;
    const invalidSchedule=await request(`/dispatch/deliveries/${multi.data.deliveries[0].id}`,'PATCH',{driverId,scheduledDate:'0000-01-01'},dispatcher);
    assert.equal(invalidSchedule.status,400,JSON.stringify(invalidSchedule.data));
    assert.equal(invalidSchedule.data.code,'invalid_input');
    assert.deepEqual((await request('/dispatch/deliveries','GET',undefined,dispatcher)).data,dispatchBefore.data,'год 0000 не назначает рейс');
    for (const [index,delivery] of multi.data.deliveries.entries()) {
      const scheduledDate=scheduledDates[index];
      const assigned=await request(`/dispatch/deliveries/${delivery.id}`,'PATCH',{driverId,scheduledDate},dispatcher);
      assert.equal(assigned.status,200,JSON.stringify(assigned.data));
      assertCalendarDate(assigned.data.scheduledDate,scheduledDate,'ответ назначения рейса');
      for (const status of ['picked_up','in_transit']) assert.equal((await request(`/driver/deliveries/${delivery.id}/events`,'POST',{status},driver)).status,201);
    }
    const dispatchAfter=await request('/dispatch/deliveries','GET',undefined,dispatcher);
    assert.equal(dispatchAfter.status,200,JSON.stringify(dispatchAfter.data));
    for (const [index,delivery] of multi.data.deliveries.entries()) {
      assertCalendarDate(dispatchAfter.data.find((row:{id:string})=>row.id===delivery.id).scheduledDate,scheduledDates[index],'диспетчерский список после назначения');
    }
    const driverList=await request('/driver/deliveries','GET',undefined,driver);
    assert.equal(driverList.status,200,JSON.stringify(driverList.data));
    for (const [index,delivery] of multi.data.deliveries.entries()) {
      assertCalendarDate(driverList.data.find((row:{id:string})=>row.id===delivery.id).scheduledDate,scheduledDates[index],'список рейсов водителя');
    }
    const finishes=await Promise.all(multi.data.deliveries.map((delivery: {id:string})=>request(`/driver/deliveries/${delivery.id}/events`,'POST',{status:'delivered'},driver)));
    assert.ok(finishes.every((result)=>result.status===201),JSON.stringify(finishes));
    assert.equal((await request(`/orders/${multi.data.id}`,'GET',undefined,a)).data.status,'delivered','заказ закрывается после параллельного завершения поставок');
    console.log('PASS: вход, сортировка и фильтры каталога, числовые суммы заказов и границы точности, снимок единицы, идемпотентность, резерв, права, позиции объекта, конкурентные заказы и поставки');
  } finally { child.kill(); await pool.end(); }
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
