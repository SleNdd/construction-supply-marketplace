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

async function main() {
  const buyer=await login('buyer@example.test');
  const product=await call('/products?q=Цемент');
  assert.equal(product.status,200);
  const detail=await call(`/products/${product.body.items[0].id}`);
  const offerId=detail.body.offers[0].id;
  const stockBefore=detail.body.offers[0].stock;
  const request={items:[{offerId,quantity:2}],address:'Астрахань, ул. Савушкина, 6'};
  const quote=await call('/quotes',{method:'POST',body:JSON.stringify(request)});
  assert.equal(quote.status,201,JSON.stringify(quote.body));
  assert.equal(quote.body.unavailable.length,0);
  const key=`smoke-${Date.now()}`;
  const create=await call('/orders',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(request)},buyer);
  assert.equal(create.status,201,JSON.stringify(create.body));
  const replay=await call('/orders',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(request)},buyer);
  assert.equal(replay.body.id,create.body.id);
  const stockAfter=(await call(`/products/${product.body.items[0].id}`)).body.offers[0].stock;
  assert.equal(stockAfter,stockBefore-2);
  const payment=await call(`/orders/${create.body.id}/demo-payment`,{method:'POST'},buyer);
  assert.equal(payment.body.status,'paid');
  const dispatcher=await login('dispatcher@example.test');
  const driver=await login('driver@example.test');
  const driverUser=(await call('/auth/me',{},driver)).body.user;
  const deliveryId=create.body.deliveries[0].id;
  const assigned=await call(`/dispatch/deliveries/${deliveryId}`,{method:'PATCH',body:JSON.stringify({driverId:driverUser.id})},dispatcher);
  assert.equal(assigned.body.status,'assigned',JSON.stringify(assigned.body));
  for (const status of ['picked_up','in_transit','delivered']) {
    const step=await call(`/driver/deliveries/${deliveryId}/events`,{method:'POST',body:JSON.stringify({status})},driver);
    assert.equal(step.body.status,status,JSON.stringify(step.body));
  }
  const completed=await call(`/orders/${create.body.id}`,{},buyer);
  assert.equal(completed.body.status,'delivered');
  const other=await login('supplier@example.test');
  assert.equal((await call(`/orders/${create.body.id}`,{},other)).status,403);
  const csrf=await call('/projects',{method:'POST',headers:{Origin:'https://foreign.example'},body:JSON.stringify({name:'x',address:'Астрахань'})},buyer);
  assert.equal(csrf.status,403);
  console.log('Smoke: каталог, цитата, заказ, повтор ключа, остаток, оплата, назначение, рейс, права — PASS');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
