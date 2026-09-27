import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTiles,calculatePaint,calculateDryMix } from '../src/calculators';
import { parseItems,getTotals,inDemoZone } from '../src/routes/orders';
import { hashPassword,verifyPassword } from '../src/security';

test('пароль хранится только как salted hash',()=>{
  const a=hashPassword('Demo2026!'); const b=hashPassword('Demo2026!');
  assert.notEqual(a,b);
  assert.ok(verifyPassword('Demo2026!',a));
  assert.equal(verifyPassword('wrong',a),false);
});

test('калькуляторы округляют количество до целых упаковок',()=>{
  assert.equal(calculateTiles({areaM2:10,tileAreaM2:0.25,tilesPerPack:12,wastePercent:10}).packages,4);
  assert.equal(calculatePaint({areaM2:35,rateLPerM2:0.1,coats:2,packSizeL:5,wastePercent:10}).packages,2);
  assert.equal(calculateDryMix({areaM2:12,layerMm:5,rateKgPerM2Mm:0.8,packSizeKg:25,wastePercent:10}).packages,3);
});

test('дубли предложения суммируются до проверки остатков',()=>{
  const offerId='11111111-1111-1111-1111-111111111111';
  const items=parseItems([{offerId,quantity:3},{offerId,quantity:4}]);
  assert.deepEqual(items,[{offerId,quantity:7}]);
  const quote=getTotals(items,[{id:offerId,supplier_id:'s1',supplier_name:'S',product_name:'P',unit:'шт.',price_kopecks:100,stock:6,delivery_days:1,delivery_cost_kopecks:500,active:true}]);
  assert.equal(quote.unavailable.length,1);
});

test('доставка начисляется один раз на поставщика',()=>{
  const a='11111111-1111-1111-1111-111111111111';
  const b='22222222-2222-2222-2222-222222222222';
  const quote=getTotals([{offerId:a,quantity:2},{offerId:b,quantity:1}],[
    {id:a,supplier_id:'s1',supplier_name:'S',product_name:'A',unit:'шт.',price_kopecks:100,stock:10,delivery_days:1,delivery_cost_kopecks:500,active:true},
    {id:b,supplier_id:'s1',supplier_name:'S',product_name:'B',unit:'шт.',price_kopecks:250,stock:10,delivery_days:2,delivery_cost_kopecks:700,active:true},
  ]);
  assert.equal(quote.itemsTotalKopecks,450);
  assert.equal(quote.deliveryTotalKopecks,700);
});

test('учебная зона требует адрес в городе, а не произвольное вхождение слова',()=>{
  assert.equal(inDemoZone('Астрахань, ул. Савушкина, 6'),true);
  assert.equal(inDemoZone('г. Астрахань, ул. Савушкина, 6'),true);
  assert.equal(inDemoZone('Волгоград, ул. Астраханская, 6'),false);
  assert.equal(inDemoZone('Астраханская область, село Началово'),false);
});
