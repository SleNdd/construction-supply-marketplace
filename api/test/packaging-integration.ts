import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type Requester=(path:string,method?:string,body?:unknown,cookie?:string,key?:string)=>Promise<{status:number;data:any}>;

export async function packagingIntegration(request:Requester,pool:Pool,buyer:string,otherBuyer:string,admin:string) {
  const beige=(await request('/products/tile-beige-box')).data;
  const grey=(await request('/products/tile-grey-box')).data;
  assert.equal(beige.unit,'коробка'); assert.deepEqual(beige.packaging,{kind:'tiles',tileAreaM2:0.36,tilesPerPack:4});
  const project=(await request('/projects','POST',{name:'Изолированный расчёт',address:'Астрахань, Тестовая, 1'},buyer)).data;
  const path=`/projects/${project.id}/items/from-calculation`;
  const body={productId:beige.id,kind:'tiles',inputs:{areaM2:24}};
  const key=randomUUID();
  const preview=await request('/calculators/material','POST',body);
  assert.equal(preview.status,201); assert.equal(preview.data.packages,19); assert.equal(preview.data.calculatedConsumption,74);
  const second=await request('/calculators/material','POST',{...body,productId:grey.id});
  assert.equal(second.data.packages,21); assert.equal(second.data.calculatedConsumption,147);
  assert.equal((await request(path,'POST',body,buyer)).status,400);
  assert.equal((await request(path,'POST',body,otherBuyer,key)).status,404);
  assert.equal((await request(path,'POST',body,undefined,key)).status,401);
  const repeated=await Promise.all(Array.from({length:6},()=>request(path,'POST',body,buyer,key)));
  assert.ok(repeated.every(r=>r.status===201),JSON.stringify(repeated));
  for (const result of repeated) assert.deepEqual(result.data,repeated[0].data);
  const original=repeated[0].data;
  assert.deepEqual(original.calculation,preview.data); assert.equal(original.item.quantity,19); assert.equal(original.item.stageDate,null); assert.equal(original.item.unit,'коробка');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_items WHERE project_id=$1',[project.id])).rows[0].n,1);
  assert.equal((await request(path,'POST',{inputs:{wastePercent:10,areaM2:24},kind:'tiles',productId:beige.id.toUpperCase(),stageDate:null},buyer,key)).data.item.id,original.item.id);
  // Retry after ignoring the prior response models an unknown network outcome.
  await request(path,'POST',body,buyer,key);
  assert.deepEqual((await request(path,'POST',body,buyer,key)).data,original);
  assert.equal((await request(path,'POST',{...body,inputs:{areaM2:25}},buyer,key)).status,409);
  const itemPath=`/projects/${project.id}/items/${original.item.id}`;
  assert.equal((await request(itemPath,'PATCH',{quantity:20},buyer)).status,200);
  assert.deepEqual((await request(path,'POST',body,buyer,key)).data,original,'повтор возвращает исходный ответ, не повторяет ручное изменение');
  assert.equal((await request(itemPath,'DELETE',undefined,buyer)).status,204);
  const deleted=await request(path,'POST',body,buyer,key);
  assert.equal(deleted.status,409); assert.equal(deleted.data.code,'calculation_item_deleted');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_items WHERE project_id=$1',[project.id])).rows[0].n,0);
  const recreated=await request(path,'POST',body,buyer,randomUUID());
  assert.equal(recreated.status,201); assert.notEqual(recreated.data.item.id,original.item.id);
  const contestedKey=randomUUID();
  const contested=await Promise.all([request(path,'POST',body,buyer,contestedKey),request(path,'POST',{...body,inputs:{areaM2:25}},buyer,contestedKey)]);
  assert.deepEqual(contested.map(r=>r.status).sort(),[201,409],'разные тела одного ключа конкурентно создают одну позицию');
  const rollbackKey=`rollback-${randomUUID()}`;
  const countBefore=(await pool.query('SELECT count(*)::int AS n FROM project_items WHERE project_id=$1',[project.id])).rows[0].n;
  // Отказ сохранения ключа проверяет откат уже вставленной позиции на изолированной БД.
  await pool.query("CREATE FUNCTION test_reject_calculation_key() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key LIKE 'rollback-%' THEN RAISE EXCEPTION 'test injected failure'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER test_reject_calculation_key BEFORE INSERT ON project_calculation_keys FOR EACH ROW EXECUTE FUNCTION test_reject_calculation_key()');
  try {
    assert.equal((await request(path,'POST',body,buyer,rollbackKey)).status,500);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_items WHERE project_id=$1',[project.id])).rows[0].n,countBefore);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_calculation_keys WHERE project_id=$1 AND key=$2',[project.id,rollbackKey])).rows[0].n,0);
  } finally {
    await pool.query('DROP TRIGGER test_reject_calculation_key ON project_calculation_keys');
    await pool.query('DROP FUNCTION test_reject_calculation_key()');
  }
  assert.equal((await request(path,'POST',body,buyer,rollbackKey)).status,201,'после отката тот же ключ допускает безопасный повтор');
  for (const field of ['packSize','tileAreaM2','tilesPerPack','packages','unknown']) {
    assert.equal((await request(path,'POST',{...body,inputs:{...body.inputs,[field]:4}},buyer,randomUUID())).status,400);
  }
  for (const inputs of [null,[],{areaM2:null},{areaM2:24,wastePercent:null}]) assert.equal((await request(path,'POST',{...body,inputs},buyer,randomUUID())).status,400);
  for (const invalidBody of [{...body,packages:1},{...body,stageDate:'2026-02-30'},{...body,kind:'paint',inputs:{areaM2:24,rateLPerM2:0.1}}]) assert.equal((await request(path,'POST',invalidBody,buyer,randomUUID())).status,400);
  const old=(await request('/products/tile-beige')).data;
  assert.equal(old.unit,'м²'); assert.equal(old.packaging,null);
  assert.equal((await request('/calculators/material','POST',{...body,productId:old.id})).data.code,'packaging_unavailable');
  for (const patch of [{unit:'коробка'},{packaging:null},{unit:old.unit}]) assert.equal((await request(`/admin/products/${old.id}`,'PATCH',patch,admin)).status,400);
  const category=(await request('/categories')).data[0];
  const testProduct={categoryId:category.id,slug:`package-${randomUUID()}`,name:'Изолированная фасовка',unit:'ведро',packaging:{kind:'paint',packSizeL:10}};
  assert.equal((await request('/admin/products','POST',{...testProduct,unit:'м²'},admin)).status,400);
  const created=await request('/admin/products','POST',testProduct,admin);
  assert.equal(created.status,201); assert.deepEqual(created.data.packaging,testProduct.packaging);
  assert.equal((await request('/calculators/material','POST',{productId:created.data.id,kind:'paint',inputs:{areaM2:1000000,rateLPerM2:10,coats:1,wastePercent:0}})).data.packages,1000000);
  assert.equal((await request('/calculators/material','POST',{productId:created.data.id,kind:'paint',inputs:{areaM2:1000001,rateLPerM2:10,coats:1,wastePercent:0}})).status,400);
  const before=(await pool.query('SELECT count(*)::int AS n FROM project_calculation_keys WHERE project_id=$1',[project.id])).rows[0].n;
  assert.equal((await request(path,'POST',{...body,inputs:{areaM2:1e9}},buyer,randomUUID())).status,400);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_calculation_keys WHERE project_id=$1',[project.id])).rows[0].n,before,'ошибка расчёта не сохраняет ключ');
  for (const product of [old,beige]) {
    const offer=product.offers[0];
    const stock=(await pool.query('SELECT stock FROM offers WHERE id=$1',[offer.id])).rows[0].stock;
    const orderBody={items:[{offerId:offer.id,quantity:2}],address:'Астрахань, Тестовая, 1'};
    const orderKey=randomUUID();
    const order=await request('/orders','POST',orderBody,buyer,orderKey);
    assert.equal(order.status,201,JSON.stringify(order.data)); assert.equal(order.data.items[0].unit,product.unit);
    assert.equal((await pool.query('SELECT stock FROM offers WHERE id=$1',[offer.id])).rows[0].stock,stock-2);
    assert.equal((await request('/orders','POST',orderBody,buyer,orderKey)).data.id,order.data.id);
    assert.equal((await request(`/orders/${order.data.id}/cancel`,'POST',undefined,buyer)).status,201);
    assert.equal((await pool.query('SELECT stock FROM offers WHERE id=$1',[offer.id])).rows[0].stock,stock);
    assert.equal((await request('/orders','POST',orderBody,buyer,orderKey)).data.items[0].unit,product.unit);
  }
  const tooMany=await request('/quotes','POST',{items:[{offerId:beige.offers[0].id,quantity:10001}],address:'Астрахань, Тестовая, 1'});
  assert.equal(tooMany.status,400,'лимит закупки 10000 сохраняется');
  console.log('PASS: фасовки, закрытые inputs, preview, владелец, 6 параллельных повторов, нормализация, неизвестный исход сети, удаление, лимиты, старый/коробочный резерв и отмена');
}
