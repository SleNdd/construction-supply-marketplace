import { expect, test, type Page } from '@playwright/test';
import { reply } from './fixtures';
import type { Product, ProductPackaging } from '../src/lib/api';

// Проверки формы с подменённым API: записи в БД не создаются.
async function mockAdmin(page:Page, products:Product[]=[], reject=false) {
  const writes:Array<{method:string;body:Record<string,unknown>}>=[];
  await page.route('**/api/v1/**', async route=>{
    const request=route.request();
    const path=new URL(request.url()).pathname.replace('/api/v1','');
    if (path==='/auth/me') return reply(route,{user:{id:'admin',name:'Администратор UI',email:'admin@example.test',role:'admin'}});
    if (path==='/categories') return reply(route,[{id:'category',name:'Материалы',slug:'materials'}]);
    if (path==='/reports/summary') return reply(route,{orders:{count:0,totalKopecks:0},deliveries:[],note:'Демонстрационные данные'});
    if (path==='/products') return reply(route,{items:products,total:products.length,page:1});
    if (path.startsWith('/admin/products') && ['POST','PATCH'].includes(request.method())) {
      const body=request.postDataJSON() as Record<string,unknown>;
      writes.push({method:request.method(),body});
      if (reject) return reply(route,{message:'Недопустимая фасовка товара'},400);
      if (request.method()==='POST') products.push({id:'created',category:'Материалы',priceFromKopecks:null,...body} as Product);
      return reply(route,{id:'created',...body});
    }
    throw new Error(`Неожиданный API запрос: ${request.method()} ${path}`);
  });
  await page.goto('/workspace');
  await expect(page.getByRole('heading',{name:/Товары/})).toBeVisible();
  return writes;
}

async function newProduct(page:Page) {
  await page.getByRole('button',{name:'Товар',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Новый товар'});
  await dialog.getByLabel('Название',{exact:true}).fill('Новая позиция');
  await dialog.getByLabel('Адрес товара').fill('new-product');
  return dialog;
}

const cases:Array<{kind:string;unit:string;packaging:ProductPackaging|null;label:string;fields:Array<[string,string]>}>=[
  {kind:'tiles',unit:'коробка',packaging:{kind:'tiles',tileAreaM2:0.36,tilesPerPack:4},label:'4 плитки × 0,36 м² = 1,44 м² / коробка',fields:[['Площадь одной плитки, м²','0.36'],['Плиток в коробке','4']]},
  {kind:'paint',unit:'ведро',packaging:{kind:'paint',packSizeL:9},label:'9 л / ведро',fields:[['Объём ведра, л','9']]},
  {kind:'dry-mix',unit:'мешок',packaging:{kind:'dry-mix',packSizeKg:30},label:'30 кг / мешок',fields:[['Масса мешка, кг','30']]},
  {kind:'',unit:'м²',packaging:null,label:'Фасовка не задана',fields:[]},
];

for (const item of cases) test(`Создание товара: фасовка ${item.kind||'не задана'}`,async({page})=>{
  const writes=await mockAdmin(page);
  const dialog=await newProduct(page);
  await dialog.getByLabel('Фасовка',{exact:true}).selectOption(item.kind);
  if (item.kind) await expect(dialog.getByLabel('Единица измерения')).toHaveJSProperty('readOnly',true);
  else await dialog.getByLabel('Единица измерения').fill(item.unit);
  for (const [label,value] of item.fields) await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole('button',{name:'Сохранить товар'}).click();
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({method:'POST',body:{unit:item.unit,packaging:item.packaging}});
  await expect(page.locator('.admin-product-row')).toContainText(item.label);
});

for (const item of cases) test(`Редактирование сохраняет единицу/фасовку ${item.kind||'не задана'}`,async({page})=>{
  const product:Product={id:'existing',name:'Прежняя позиция',slug:'existing',category:'Материалы',categoryId:'category',unit:item.unit,packaging:item.packaging,priceFromKopecks:null,specs:{'фасовка':'999 — произвольное описание'}};
  const writes=await mockAdmin(page,[product]);
  await page.locator('.admin-product-row').getByRole('button',{name:'Изменить'}).click();
  const dialog=page.getByRole('dialog',{name:'Изменить товар'});
  await expect(dialog.getByLabel('Единица измерения')).toHaveJSProperty('readOnly',true);
  await expect(dialog.getByText(`Фасовка: ${item.label}`,{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Фасовка',{exact:true})).toHaveCount(0);
  await dialog.getByLabel('Описание',{exact:true}).fill('Новое описание');
  await dialog.getByRole('button',{name:'Сохранить товар'}).click();
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(1);
  expect(writes[0].method).toBe('PATCH');
  expect(writes[0].body).not.toHaveProperty('unit');
  expect(writes[0].body).not.toHaveProperty('packaging');
  expect(writes[0].body).toMatchObject({description:'Новое описание',specs:product.specs});
});

test('Нулевой размер фасовки блокирует отправку',async({page})=>{
  const writes=await mockAdmin(page);
  const dialog=await newProduct(page);
  await dialog.getByLabel('Фасовка',{exact:true}).selectOption('paint');
  await dialog.getByLabel('Объём ведра, л').fill('0');
  // min=0 пропускает ноль в обработчик, который сообщает строгий положительный предел.
  expect(await dialog.getByLabel('Объём ведра, л').evaluate(element=>(element as HTMLInputElement).checkValidity())).toBe(true);
  await dialog.getByRole('button',{name:'Сохранить товар'}).click();
  await expect(dialog.getByRole('alert')).toContainText('положительный размер фасовки');
  expect(writes).toHaveLength(0);
});

test('Ошибка API сохраняет фасовку в открытой форме для исправления',async({page})=>{
  const writes=await mockAdmin(page,[],true);
  const dialog=await newProduct(page);
  await dialog.getByLabel('Фасовка',{exact:true}).selectOption('paint');
  await dialog.getByLabel('Объём ведра, л').fill('9');
  await dialog.getByRole('button',{name:'Сохранить товар'}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Недопустимая фасовка товара');
  await expect(dialog.getByLabel('Объём ведра, л')).toHaveValue('9');
  await expect(dialog.getByRole('button',{name:'Сохранить товар'})).toBeEnabled();
  expect(writes).toHaveLength(1);
});
