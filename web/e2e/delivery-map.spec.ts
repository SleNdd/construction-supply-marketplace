import { test, expect, type Page, type Route } from '@playwright/test';
import { cartItem, mockCheckout, reply, validQuote } from './fixtures';
const addressText='Астрахань, ул. Савушкина, 6';
const point=[48.057,46.371];
test('Выбор точки, повтор с тем же ключом, новая точка и ручная правка',async({page})=>{
  const requests:Array<{body:Record<string,unknown>;key:string|undefined}>=[];
  let coordinates=point;
  await mockCheckout(page,async(route,path)=>{
    if(path==='/quotes'){await reply(route,validQuote);return true;}
    if(path==='/geo/suggest'){await reply(route,{source:'demo',items:[{value:addressText,coordinates}]});return true;}
    if(path==='/orders'){requests.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});await route.abort('failed');return true;}
    return false;
  });
  const address=page.getByLabel('Адрес объекта или доставки'),confirm=page.getByRole('button',{name:'Подтвердить заказ',exact:true});
  async function select(){await address.fill('Савушкина');await page.getByRole('button',{name:addressText,exact:true}).click();await expect(confirm).toBeEnabled();}
  await select();await confirm.click();await expect(page.locator('.checkout-form').getByRole('alert')).toBeVisible();
  await page.reload();await expect(address).toHaveValue(addressText);await expect(confirm).toBeEnabled();await confirm.click();await expect.poll(()=>requests.length).toBe(2);
  expect(requests[0].body.destinationCoordinates).toEqual(point);expect(requests[1]).toEqual(requests[0]);
  coordinates=[48.058,46.372];await select();await confirm.click();await expect.poll(()=>requests.length).toBe(3);
  expect(requests[2].body.destinationCoordinates).toEqual(coordinates);expect(requests[2].key).not.toBe(requests[0].key);
  await address.fill(`${addressText}, корпус 2`);await expect(confirm).toBeEnabled();await confirm.click();await expect.poll(()=>requests.length).toBe(4);
  expect(requests[3].body).not.toHaveProperty('destinationCoordinates');expect(requests[3].key).not.toBe(requests[2].key);
});
test('Начальный ручной адрес оформляется без точки',async({page})=>{
  let body:Record<string,unknown>|undefined;
  await mockCheckout(page,async(route,path)=>{
    if(path==='/quotes'){await reply(route,validQuote);return true;}
    if(path==='/orders'){body=route.request().postDataJSON();await route.abort('failed');return true;}
    return false;
  });
  await page.goto(`/checkout?address=${encodeURIComponent(addressText)}`);
  const confirm=page.getByRole('button',{name:'Подтвердить заказ',exact:true});await expect(confirm).toBeEnabled();await confirm.click();
  await expect.poll(()=>body?.address).toBe(addressText);expect(body).not.toHaveProperty('destinationCoordinates');
});
const warehouses=[{warehouseId:'w1',name:'Северный склад',address:'Складская, 1',coordinates:[48.01,46.31]},{warehouseId:'w2',name:'Южный склад',address:'Складская, 2',coordinates:[48.02,46.32]}];
const deliveries=[{id:'delivery1',orderId:'order1',supplierName:'Первый поставщик',status:'assigned',address:addressText,destinationCoordinates:point,departurePoints:warehouses},{id:'delivery2',orderId:'order1',supplierName:'Второй поставщик',status:'assigned',address:'Другой адрес',destinationCoordinates:[48.08,46.38],departurePoints:[{...warehouses[0],warehouseId:'w3',coordinates:[48.03,46.33]}]}];
async function fixture(page:Page,handler:(route:Route)=>Promise<void>,driver=false,missing=false,missingWarehouse=false){
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    if(path==='/auth/me')return reply(route,{user:{id:'u',name:'Карта UI',email:'fixture@example.test',role:driver?'driver':'buyer'}});
    if(path==='/categories')return reply(route,[]);
    if(path==='/products')return reply(route,{items:[],total:0});
    if(path==='/geo/config')return reply(route,{mapKey:null});
    if(path==='/geo/route')return handler(route);
    if(path==='/driver/deliveries')return reply(route,deliveries);
    if(path==='/orders/order1')return reply(route,{id:'order1',status:'paid',createdAt:'2026-10-01',address:addressText,destinationCoordinates:missing?null:point,items:[],deliveries:missingWarehouse?deliveries.map(row=>({...row,departurePoints:row.departurePoints.map(warehouse=>({...warehouse,coordinates:null}))})):deliveries,totalKopecks:30000});
    throw new Error(`Неожиданный запрос карты: ${path}`);
  });
  await page.goto(driver?'/workspace':'/orders/order1');await expect(page.getByRole('region',{name:'Карта поставки'})).toBeVisible();
}
function geometry(route:Route,source='demo'){
  const q=new URL(route.request().url()).searchParams;
  return {source,coordinates:[[Number(q.get('fromLon')),Number(q.get('fromLat'))],[Number(q.get('toLon')),Number(q.get('toLat'))]],distanceMeters:source==='demo'?null:1234,durationSeconds:source==='demo'?null:120};
}
test('Смена склада и поставки, устаревший ответ, ошибка и повтор',async({page})=>{
  const requests:URL[]=[];let old:Route|undefined;let fail=true;
  await fixture(page,async route=>{
    const url=new URL(route.request().url());requests.push(url);
    if(url.searchParams.get('fromLon')==='48.01'){old=route;return;}
    if(fail){await reply(route,{message:'Маршруты временно недоступны'},502);return;}
    await reply(route,geometry(route,'2gis'));
  });
  await expect.poll(()=>Boolean(old)).toBe(true);expect(requests[0].searchParams.get('toLon')).toBe('48.057');
  await page.getByLabel('Склад отправления').selectOption('w2');await expect(page.getByRole('region',{name:'Карта поставки'}).getByRole('alert')).toHaveText('Маршруты временно недоступны');
  await reply(old!,geometry(old!));await expect(page.getByTestId('route-geometry')).toHaveCount(0);
  fail=false;await page.getByRole('button',{name:'Повторить маршрут'}).click();await expect(page.getByTestId('route-geometry')).toBeVisible();
  await expect(page.getByText('Расстояние: 1.2 км.',{exact:false})).toBeVisible();expect(requests.at(-1)?.searchParams.get('fromLon')).toBe('48.02');
  await page.getByLabel('Поставка на карте').selectOption('delivery2');await expect.poll(()=>requests.at(-1)?.searchParams.get('fromLon')).toBe('48.03');
});
test('Назначенный рейс задаёт обе точки; телефон и две темы',async({page})=>{
  const requests:URL[]=[];await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await fixture(page,async route=>{requests.push(new URL(route.request().url()));await reply(route,geometry(route));},true);
  await expect(page.getByTestId('route-geometry')).toBeVisible();
  for(const theme of ['light','dark']){
    if(theme==='dark'){await page.getByRole('button',{name:'Открыть меню',exact:true}).click();await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();await page.getByRole('button',{name:'Закрыть меню',exact:true}).click();}
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    for(const name of ['Рейс на карте','Склад отправления'])expect((await page.getByLabel(name).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
  await page.getByLabel('Рейс на карте').selectOption('delivery2');await expect.poll(()=>requests.at(-1)?.searchParams.get('toLon')).toBe('48.08');
  expect(requests.at(-1)?.searchParams.get('fromLon')).toBe('48.03');await expect(page.getByText('Доставка: Другой адрес')).toBeVisible();
});
test('Без координат не вызывается маршрут и не рисуется линия',async({page})=>{
  let requests=0;await fixture(page,async route=>{requests++;await reply(route,geometry(route));},false,true);
  await expect(page.getByText('Точка доставки не выбрана.',{exact:false})).toBeVisible();await expect(page.getByTestId('route-geometry')).toHaveCount(0);expect(requests).toBe(0);
});

for(const axis of ['horizontal','vertical'])test(`Геометрия ${axis} занимает видимый участок сетки`,async({page})=>{
  await fixture(page,async route=>reply(route,{source:'demo',coordinates:axis==='horizontal'?[[48,46],[48.01,46]]:[[48,46],[48,46.01]],distanceMeters:null,durationSeconds:null}));
  const line=page.getByTestId('route-geometry');await expect(page.getByRole('img',{name:'Геометрия выбранного участка доставки'})).toBeVisible();await expect(line).toHaveAttribute('points',/.+/);
  const points=(await line.getAttribute('points'))!.split(' ').map(pair=>pair.split(',').map(Number));
  expect(Math.abs(points[1][axis==='horizontal'?0:1]-points[0][axis==='horizontal'?0:1])).toBeGreaterThanOrEqual(159);
});

test('Без координат склада маршрут не вызывается',async({page})=>{
  let requests=0;await fixture(page,async route=>{requests++;await reply(route,geometry(route));},false,false,true);
  await expect(page.getByText('У выбранного склада нет координат.',{exact:false})).toBeVisible();
  await expect(page.getByTestId('route-geometry')).toHaveCount(0);expect(requests).toBe(0);
});
test('Повреждённая геометрия не изображается успешным маршрутом',async({page})=>{
  await fixture(page,async route=>reply(route,{source:'2gis',coordinates:[[48,46],[48]],distanceMeters:100,durationSeconds:1}));
  await expect(page.getByRole('region',{name:'Карта поставки'}).getByRole('alert')).toHaveText('Сервис вернул некорректную геометрию маршрута');
  await expect(page.getByTestId('route-geometry')).toHaveCount(0);
});

for(const mismatch of ['buyer','cart','context','malformed','foreign-project'])test(`Pending заказ не восстанавливается: ${mismatch}`,async({page})=>{
  await mockCheckout(page,async(route,path)=>{if(path==='/quotes'){await reply(route,validQuote);return true;}return false;});
  const payload={items:[{offerId:cartItem.offerId,quantity:mismatch==='cart'?2:1}],address:addressText,destinationCoordinates:point,...(mismatch==='foreign-project'?{projectId:'cccccccc-0000-4000-8000-000000000001'}:{})};
  await page.evaluate(({mismatch,payload})=>sessionStorage.setItem('objectmarket-checkout-key',JSON.stringify({buyerId:mismatch==='buyer'?'another-buyer':'fixture-buyer',context:mismatch==='context'?'another-context':'[null,null]',key:'bbbbbbbb-0000-4000-8000-000000000001',signature:mismatch==='malformed'?'broken':JSON.stringify(payload)})),{mismatch,payload});
  await page.reload();await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue('');
  if(mismatch==='foreign-project'){await expect(page.locator('.checkout-form').getByRole('alert')).toContainText('Объект сохранённого заказа недоступен');await expect(page.getByRole('button',{name:'Подтвердить заказ',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Начать новое оформление',exact:true}).click();}
  await page.getByLabel('Адрес объекта или доставки').fill('Новый ручной адрес');await expect(page.getByRole('button',{name:'Подтвердить заказ',exact:true})).toBeEnabled();
});

test('Pending проекта восстанавливается после проверки owned projects',async({page})=>{
  const projectId='cccccccc-0000-4000-8000-000000000001';let projects:Route|undefined;
  await mockCheckout(page,async(route,path)=>{
    if(path==='/projects'){projects=route;return true;}
    if(path==='/quotes'){await reply(route,validQuote);return true;}return false;
  });
  const payload={items:[{offerId:cartItem.offerId,quantity:1}],address:addressText,requestedDate:'2030-10-15',projectId,destinationCoordinates:point};
  await page.evaluate(payload=>sessionStorage.setItem('objectmarket-checkout-key',JSON.stringify({buyerId:'fixture-buyer',context:'[null,null]',key:'bbbbbbbb-0000-4000-8000-000000000001',signature:JSON.stringify(payload)})),payload);
  projects=undefined;await page.reload();await expect.poll(()=>Boolean(projects)).toBe(true);
  await expect(page.getByRole('button',{name:'Подтвердить заказ',exact:true})).toBeDisabled();
  await reply(projects!,[{id:projectId,name:'Мой объект'}]);
  await expect(page.getByLabel('Адрес объекта или доставки')).toHaveValue(addressText);await expect(page.getByLabel('Желаемая дата')).toHaveValue('2030-10-15');
  await expect(page.locator('.checkout-form select')).toHaveValue(projectId);
});
test('До восстановления заказа нельзя править адрес, дату и объект; повтор сохраняет ключ',async({page})=>{
  const projectId='cccccccc-0000-4000-8000-000000000001';let projects:Route|undefined;let hold=false;let sent:Record<string,unknown>|undefined;let key:string|undefined;
  await mockCheckout(page,async(route,path)=>{
    if(path==='/projects'){if(hold){projects=route;return true;}await reply(route,[]);return true;}
    if(path==='/quotes'){await reply(route,validQuote);return true;}
    if(path==='/orders'){sent=route.request().postDataJSON();key=route.request().headers()['idempotency-key'];await route.abort('failed');return true;}
    return false;
  });
  const payload={items:[{offerId:cartItem.offerId,quantity:1}],address:addressText,requestedDate:'2030-10-15',projectId,destinationCoordinates:point};
  await page.evaluate(({payload,addressText})=>sessionStorage.setItem('objectmarket-checkout-key',JSON.stringify({buyerId:'fixture-buyer',context:JSON.stringify([addressText,null]),key:'bbbbbbbb-0000-4000-8000-000000000001',signature:JSON.stringify(payload)})),{payload,addressText});
  hold=true;await page.goto(`/checkout?address=${encodeURIComponent(addressText)}`);await expect.poll(()=>Boolean(projects)).toBe(true);
  await expect(page.getByLabel('Адрес объекта или доставки')).toBeDisabled();
  await expect(page.getByLabel('Желаемая дата')).toBeDisabled();
  await expect(page.locator('.checkout-form select')).toBeDisabled();
  await expect(page.getByRole('button',{name:addressText,exact:true})).toHaveCount(0);
  await reply(projects!,[{id:projectId,name:'Мой объект'}]);
  await expect(page.getByLabel('Адрес объекта или доставки')).toBeEnabled();
  await expect(page.getByLabel('Желаемая дата')).toHaveValue('2030-10-15');
  await expect(page.locator('.checkout-form select')).toHaveValue(projectId);
  const confirm=page.getByRole('button',{name:'Подтвердить заказ',exact:true});await expect(confirm).toBeEnabled();await confirm.click();
  await expect.poll(()=>sent).toEqual(payload);expect(key).toBe('bbbbbbbb-0000-4000-8000-000000000001');
});

test('Pending проект: медленная и ошибочная проверка не создаёт новое намерение',async({page})=>{
  const projectId='cccccccc-0000-4000-8000-000000000001';let projects:Route|undefined;let hold=false;let restored=false;let sent:Record<string,unknown>|undefined;let key:string|undefined;
  await mockCheckout(page,async(route,path)=>{
    if(path==='/projects'){if(hold&&!restored){projects=route;return true;}await reply(route,restored?[{id:projectId,name:'Мой объект'}]:[]);return true;}
    if(path==='/quotes'){await reply(route,validQuote);return true;}
    if(path==='/orders'){sent=route.request().postDataJSON();key=route.request().headers()['idempotency-key'];await route.abort('failed');return true;}
    return false;
  });
  const payload={items:[{offerId:cartItem.offerId,quantity:1}],address:addressText,requestedDate:'2030-10-15',projectId,destinationCoordinates:point};
  await page.evaluate(({payload,addressText})=>sessionStorage.setItem('objectmarket-checkout-key',JSON.stringify({buyerId:'fixture-buyer',context:JSON.stringify([addressText,null]),key:'bbbbbbbb-0000-4000-8000-000000000001',signature:JSON.stringify(payload)})),{payload,addressText});
  hold=true;await page.goto(`/checkout?address=${encodeURIComponent(addressText)}`);await expect.poll(()=>Boolean(projects)).toBe(true);
  await expect(page.locator('.summary-total b')).toContainText('300');
  const confirm=page.getByRole('button',{name:'Подтвердить заказ',exact:true});await expect(confirm).toBeDisabled();
  await reply(projects!,{message:'Не удалось загрузить объекты'},502);
  await expect(page.locator('.checkout-form').getByRole('alert')).toContainText('Не удалось проверить объект сохранённого заказа');await expect(confirm).toBeDisabled();
  restored=true;await page.getByRole('button',{name:'Повторить проверку объекта',exact:true}).click();
  await expect(page.getByLabel('Желаемая дата')).toHaveValue('2030-10-15');await expect(confirm).toBeEnabled();await confirm.click();await expect.poll(()=>sent).toEqual(payload);
  expect(key).toBe('bbbbbbbb-0000-4000-8000-000000000001');
});
