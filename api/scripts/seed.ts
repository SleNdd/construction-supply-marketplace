import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { hashPassword } from '../src/security';

const id = (key: string) => {
  const h = createHash('md5').update(`objectmarket-demo-${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (process.env.DEMO_SEED !== 'true') throw new Error('Демоданные не загружены: задайте DEMO_SEED=true явно');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = [
      ['buyer','Покупатель Демо','buyer@example.test'],
      ['supplier1','Поставщик Волга','supplier@example.test'],
      ['supplier2','Поставщик Каспий','supplier2@example.test'],
      ['dispatcher','Диспетчер Демо','dispatcher@example.test'],
      ['driver','Водитель Демо','driver@example.test'],
      ['admin','Администратор Демо','admin@example.test'],
    ] as const;
    const passwordHash = hashPassword('Demo2026!');
    for (const [key,name,email] of users) {
      const role = key.startsWith('supplier') ? 'supplier' : key;
      await client.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [id(key),name,email,passwordHash,role]);
    }
    const suppliers = [['volga','ВолгаСтрой Снаб','supplier1'],['kaspiy','Каспий Материал','supplier2']] as const;
    for (const [key,name,owner] of suppliers) await client.query('INSERT INTO suppliers(id,name,owner_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id(key),name,id(owner)]);
    const warehouses = [
      ['volga-main','Склад на Магистральной','volga','Астрахань, ул. Магистральная, 16',48.003,46.351],
      ['kaspiy-main','Склад на Рождественского','kaspiy','Астрахань, ул. Рождественского, 17',48.033,46.284],
    ] as const;
    for (const [key,name,supplier,address,lon,lat] of warehouses) await client.query('INSERT INTO warehouses(id,supplier_id,name,address,lon,lat) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[id(key),id(supplier),name,address,lon,lat]);
    const categories = [['dry','Сухие смеси','sukhie-smesi'],['paint','Краски и отделка','kraski-i-otdelka'],['tile','Плитка','plitka'],['wood','Пиломатериалы','pilomaterialy'],['insulation','Изоляция','izolyatsiya']] as const;
    for (const [key,name,slug] of categories) await client.query('INSERT INTO categories(id,name,slug) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id(key),name,slug]);
    const products = [
      ['cement','dry','Цемент М500 50 кг','мешок',{'Вес':'50 кг','Марка':'М500'},'Портландцемент для общестроительных работ.'],
      ['plaster','dry','Штукатурка гипсовая 30 кг','мешок',{'Вес':'30 кг','Расход':'0,85 кг/м²·мм'},'Сухая смесь для внутренних стен.'],
      ['adhesive','dry','Клей плиточный 25 кг','мешок',{'Вес':'25 кг','Класс':'C1'},'Клей для керамической плитки.'],
      ['paint-white','paint','Краска интерьерная белая 10 л','ведро',{'Объём':'10 л','Расход':'0,11 л/м²'},'Водно-дисперсионная краска для стен и потолков.'],
      ['paint-facade','paint','Краска фасадная 9 л','ведро',{'Объём':'9 л','Расход':'0,15 л/м²'},'Фасадная краска для минеральных оснований.'],
      ['tile-beige','tile','Керамогранит Песчаник 60×60','м²',{'Формат':'60×60 см','Площадь коробки':'1,44 м²'},'Матовый керамогранит песочного оттенка.'],
      ['tile-grey','tile','Плитка настенная Графит 30×60','м²',{'Формат':'30×60 см','Площадь коробки':'1,26 м²'},'Настенная плитка серого оттенка.'],
      ['board','wood','Доска обрезная 25×150×6000','шт.',{'Порода':'Сосна','Влажность':'18–22%'},'Доска для общестроительных работ.'],
      ['plywood','wood','Фанера ФК 12 мм 1525×1525','лист',{'Толщина':'12 мм','Сорт':'2/4'},'Фанера для внутренних работ.'],
      ['wool','insulation','Минеральная вата 50 мм 6 м²','упаковка',{'Толщина':'50 мм','Площадь':'6 м²'},'Теплоизоляция для перегородок.'],
      ['membrane','insulation','Пароизоляционная мембрана 70 м²','рулон',{'Площадь':'70 м²'},'Пароизоляция для каркасных конструкций.'],
    ] as const;
    for (const [key,category,name,unit,specs,description] of products) await client.query('INSERT INTO products(id,category_id,slug,name,unit,description,specs) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[id(key),id(category),key,name,unit,description,JSON.stringify(specs)]);
    for (let index=0; index<products.length; index++) {
      for (let supplierIndex=0; supplierIndex<2; supplierIndex++) {
        const supplier = supplierIndex ? 'kaspiy' : 'volga';
        const warehouse = supplierIndex ? 'kaspiy-main' : 'volga-main';
        await client.query('INSERT INTO offers(id,product_id,supplier_id,warehouse_id,price_kopecks,stock,delivery_days,delivery_cost_kopecks) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[id(`offer-${products[index][0]}-${supplier}`),id(products[index][0]),id(supplier),id(warehouse),42000+index*17300+supplierIndex*4100,40+index*3+supplierIndex*12,1+supplierIndex,65000+supplierIndex*20000]);
      }
    }
    await client.query('INSERT INTO projects(id,buyer_id,name,address,stages) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id('project-demo'),id('buyer'),'Ремонт жилого дома','Астрахань, ул. Савушкина, 6',JSON.stringify([{name:'Черновые работы',date:'2026-10-10'},{name:'Отделка',date:'2026-11-01'}])]);
    await client.query('INSERT INTO project_items(id,project_id,product_id,quantity,stage_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id('project-item-cement'),id('project-demo'),id('cement'),12,'2026-10-10']);
    for (const demo of [
      {key:'demo-order-active',product:'cement',quantity:4,status:'paid',delivery:'assigned'},
      {key:'demo-order-complete',product:'paint-white',quantity:2,status:'delivered',delivery:'delivered'},
    ]) {
      const offerId=id(`offer-${demo.product}-volga`);
      const offer=await client.query<{price_kopecks:number;delivery_cost_kopecks:number}>('SELECT price_kopecks,delivery_cost_kopecks FROM offers WHERE id=$1',[offerId]);
      const price=offer.rows[0].price_kopecks;
      const deliveryCost=offer.rows[0].delivery_cost_kopecks;
      const inserted=await client.query<{id:string}>('INSERT INTO orders(id,buyer_id,project_id,address,status,items_total_kopecks,delivery_total_kopecks) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',[id(demo.key),id('buyer'),id('project-demo'),'Астрахань, ул. Савушкина, 6',demo.status,price*demo.quantity,deliveryCost]);
      if (!inserted.rowCount) continue;
      await client.query('UPDATE offers SET stock=stock-$1 WHERE id=$2',[demo.quantity,offerId]);
      await client.query('INSERT INTO order_items(id,order_id,offer_id,supplier_id,product_name,quantity,price_kopecks) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(`${demo.key}-item`),id(demo.key),offerId,id('volga'),demo.product==='cement'?'Цемент М500 50 кг':'Краска интерьерная белая 10 л',demo.quantity,price]);
      await client.query('INSERT INTO deliveries(id,order_id,supplier_id,driver_id,status,scheduled_date,route,delivery_cost_kopecks) VALUES($1,$2,$3,$4,$5,current_date+1,$6,$7)',[id(`${demo.key}-delivery`),id(demo.key),id('volga'),id('driver'),demo.delivery,JSON.stringify([[48.003,46.351],[48.025,46.36],[48.057,46.371]]),deliveryCost]);
    }
    await client.query('COMMIT');
    console.log('Демоданные добавлены; существующие записи не изменены. Пароль демонстрационных аккаунтов: Demo2026!');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode=1; });
