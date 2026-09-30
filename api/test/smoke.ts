import assert from 'node:assert/strict';

const base=process.env.API_BASE_URL||'http://localhost:4000/api/v1';
async function call(path:string,options:RequestInit={},cookie?:string) {
  const response=await fetch(base+path,{...options,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...options.headers}});
  const body=await response.json();
  return {status:response.status,body,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email:string) {
  const result=await call('/auth/login',{method:'POST',body:JSON.stringify({email,password:'Demo2026!'})});
  assert.equal(result.status,201,JSON.stringify(result.body));
  assert.ok(result.cookie);
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

async function main() {
  const buyer=await login('buyer@example.test');
  const product=await call('/products?q=Цемент');
  assert.equal(product.status,200);
  const detail=await call(`/products/${product.body.items[0].id}`);
  const offerId=detail.body.offers[0].id;
  const stockBefore=detail.body.offers[0].stock;
  const requestedDate='2030-01-02';
  const request={items:[{offerId,quantity:2}],address:'Астрахань, ул. Савушкина, 6',requestedDate};
  const quote=await call('/quotes',{method:'POST',body:JSON.stringify(request)});
  assert.equal(quote.status,201,JSON.stringify(quote.body));
  assert.equal(quote.body.unavailable.length,0);
  const key=`smoke-${Date.now()}`;
  const create=await call('/orders',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(request)},buyer);
  assert.equal(create.status,201,JSON.stringify(create.body));
  assertOrderMoney(create.body,quote.body,'создание заказа');
  const replay=await call('/orders',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(request)},buyer);
  assert.equal(replay.status,201,JSON.stringify(replay.body));
  assert.equal(replay.body.id,create.body.id);
  assertOrderMoney(replay.body,quote.body,'повтор создания');
  const orderDetail=await call(`/orders/${create.body.id}`,{},buyer);
  assert.equal(orderDetail.status,200);
  assertOrderMoney(orderDetail.body,quote.body,'карточка заказа');
  assertCalendarDate(orderDetail.body.requestedDate,requestedDate,'карточка заказа');
  const orders=await call('/orders',{},buyer);
  assert.equal(orders.status,200);
  assertOrderMoney(orders.body.find((order:{id:string})=>order.id===create.body.id),quote.body,'список заказов');
  assertCalendarDate(orders.body.find((order:{id:string})=>order.id===create.body.id).requestedDate,requestedDate,'список заказов');
  const stockAfter=(await call(`/products/${product.body.items[0].id}`)).body.offers[0].stock;
  assert.equal(stockAfter,stockBefore-2);
  const payment=await call(`/orders/${create.body.id}/demo-payment`,{method:'POST'},buyer);
  assert.equal(payment.status,201,JSON.stringify(payment.body));
  assert.equal(payment.body.status,'paid');
  assertOrderMoney(payment.body,quote.body,'оплата заказа');
  const dispatcher=await login('dispatcher@example.test');
  const driver=await login('driver@example.test');
  const driverUser=(await call('/auth/me',{},driver)).body.user;
  const deliveryId=create.body.deliveries[0].id;
  const scheduledDate='2030-02-03';
  const assigned=await call(`/dispatch/deliveries/${deliveryId}`,{method:'PATCH',body:JSON.stringify({driverId:driverUser.id,scheduledDate})},dispatcher);
  assert.equal(assigned.body.status,'assigned',JSON.stringify(assigned.body));
  assertCalendarDate(assigned.body.scheduledDate,scheduledDate,'ответ назначения рейса');
  const dispatchList=await call('/dispatch/deliveries',{},dispatcher);
  assert.equal(dispatchList.status,200,JSON.stringify(dispatchList.body));
  assertCalendarDate(dispatchList.body.find((delivery:{id:string})=>delivery.id===deliveryId).scheduledDate,scheduledDate,'список диспетчера');
  const driverList=await call('/driver/deliveries',{},driver);
  assert.equal(driverList.status,200,JSON.stringify(driverList.body));
  assertCalendarDate(driverList.body.find((delivery:{id:string})=>delivery.id===deliveryId).scheduledDate,scheduledDate,'список водителя');
  for (const status of ['picked_up','in_transit','delivered']) {
    const step=await call(`/driver/deliveries/${deliveryId}/events`,{method:'POST',body:JSON.stringify({status})},driver);
    assert.equal(step.body.status,status,JSON.stringify(step.body));
  }
  const completed=await call(`/orders/${create.body.id}`,{},buyer);
  assert.equal(completed.body.status,'delivered');
  assertOrderMoney(completed.body,quote.body,'доставленный заказ');
  const other=await login('supplier@example.test');
  assert.equal((await call(`/orders/${create.body.id}`,{},other)).status,403);
  const csrf=await call('/projects',{method:'POST',headers:{Origin:'https://foreign.example'},body:JSON.stringify({name:'x',address:'Астрахань'})},buyer);
  assert.equal(csrf.status,403);
  console.log('Smoke: каталог, цитата, заказ, повтор ключа, остаток, оплата, назначение, рейс, права — PASS');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
