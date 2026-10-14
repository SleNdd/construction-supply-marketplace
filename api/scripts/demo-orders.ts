import type { PoolClient } from 'pg';
import { earliestDateInAstrakhan } from '../src/calendar-date';
import { snapshotDeparturePoints, type WarehousePointRow } from '../src/delivery-points';
import { demoOrders, type DemoOrder } from './demo-catalog';

type OfferSnapshot = WarehousePointRow & {
  id: string; supplier_id: string; name: string; unit: string; price_kopecks: number;
  delivery_cost_kopecks: number; stock: number; active: boolean;
};

export async function seedDemoOrders(client: PoolClient, id: (key:string)=>string, now: Date) {
  // Используем те же роли и переходы, что и API. Назначение диспетчером не создаёт событие водителя.
  const roles = await client.query<{id:string;role:string}>('SELECT id,role FROM users WHERE id=ANY($1::uuid[])',[[id('buyer'),id('driver')]]);
  if (!roles.rows.some(row=>row.id===id('buyer') && row.role==='buyer') || !roles.rows.some(row=>row.id===id('driver') && row.role==='driver')) {
    throw new Error('Роли учебного покупателя и водителя не соответствуют сценариям');
  }
  for (const demo of demoOrders) await seedOrder(client,id,now,demo);
}

async function seedOrder(client: PoolClient, id: (key:string)=>string, now: Date, demo: DemoOrder) {
  if ((await client.query('SELECT 1 FROM orders WHERE id=$1',[id(demo.key)])).rowCount) return;
  const offerIds = demo.items.map(([product,supplier])=>id(`offer-${product}-${supplier}`));
  const offers = (await client.query<OfferSnapshot>(`SELECT o.id,o.supplier_id,o.price_kopecks,o.delivery_cost_kopecks,o.stock,o.active,
    p.name,p.unit,w.id AS warehouse_id,w.name AS warehouse_name,w.address AS warehouse_address,w.lon AS warehouse_lon,w.lat AS warehouse_lat
    FROM offers o JOIN products p ON p.id=o.product_id JOIN warehouses w ON w.id=o.warehouse_id
    WHERE o.id=ANY($1::uuid[]) ORDER BY o.id FOR UPDATE OF o`,[offerIds])).rows;
  const lines = demo.items.map(([product,supplier,quantity])=>{
    const offer = offers.find(row=>row.id===id(`offer-${product}-${supplier}`));
    if (!offer || offer.supplier_id!==id(supplier) || !offer.active || offer.stock<quantity) throw new Error(`Недоступен учебный запас: ${product}/${supplier}`);
    return {offer,quantity};
  });
  const shipping = new Map<string,number>();
  for (const {offer} of lines) shipping.set(offer.supplier_id,Math.max(shipping.get(offer.supplier_id) ?? 0,offer.delivery_cost_kopecks));
  const deliveryStatuses = Object.values(demo.deliveries);
  if (shipping.size!==deliveryStatuses.length || lines.some(({offer})=>!demo.deliveries[offer.supplier_id===id('volga')?'volga':'kaspiy'])) throw new Error(`Неполный состав поставок: ${demo.key}`);
  const status = demo.terminal ?? (deliveryStatuses.every(status=>status==='delivered') ? 'delivered' : deliveryStatuses.some(status=>['picked_up','in_transit','delivered'].includes(status)) ? 'in_progress' : 'paid');
  const createdAt = new Date(now.getTime()-demo.daysAgo*86_400_000);
  const inserted = await client.query(`INSERT INTO orders(id,buyer_id,project_id,address,status,items_total_kopecks,delivery_total_kopecks,destination_lon,destination_lat,created_at,reservation_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,[
    id(demo.key),id('buyer'),id(demo.project),demo.address,status,
    lines.reduce((sum,line)=>sum+line.offer.price_kopecks*line.quantity,0),[...shipping.values()].reduce((sum,cost)=>sum+cost,0),
    demo.coordinates?.[0] ?? null,demo.coordinates?.[1] ?? null,createdAt,demo.terminal ? new Date(createdAt.getTime()+30*60_000) : null,
  ]);
  if (!inserted.rowCount) return;
  for (let index=0;index<lines.length;index++) {
    const {offer,quantity} = lines[index];
    // Закрытые исторические резервы не удерживают запас и не имитируют его возврат.
    if (!demo.terminal) {
      const deducted = await client.query('UPDATE offers SET stock=stock-$1 WHERE id=$2 AND active AND stock>=$1 RETURNING id',[quantity,offer.id]);
      if (!deducted.rowCount) throw new Error(`Недостаточный остаток: ${offer.id}`);
    }
    const itemKey = demo.key==='demo-order-active' || demo.key==='demo-order-complete' ? `${demo.key}-item` : `${demo.key}-item-${index}`;
    await client.query('INSERT INTO order_items(id,order_id,offer_id,supplier_id,product_name,unit,quantity,price_kopecks) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id(itemKey),id(demo.key),offer.id,offer.supplier_id,offer.name,offer.unit,quantity,offer.price_kopecks]);
  }
  for (const [supplier,status] of Object.entries(demo.deliveries)) {
    const supplierId = id(supplier);
    const key = demo.key==='demo-order-active' || demo.key==='demo-order-complete' ? `${demo.key}-delivery` : `${demo.key}-delivery-${supplier}`;
    const deliveryId = id(key);
    const driver = status==='pending' || status==='cancelled' ? null : id('driver');
    const completed = status==='delivered';
    const scheduledDate = status==='pending' || status==='cancelled' ? null : completed ? earliestDateInAstrakhan(1,createdAt) : earliestDateInAstrakhan(status==='assigned'?1:0,now);
    await client.query('INSERT INTO deliveries(id,order_id,supplier_id,driver_id,status,scheduled_date,route,delivery_cost_kopecks,departure_points) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
      deliveryId,id(demo.key),supplierId,driver,status,scheduledDate,JSON.stringify([]),shipping.get(supplierId),JSON.stringify(snapshotDeparturePoints(lines.filter(line=>line.offer.supplier_id===supplierId).map(line=>line.offer))),
    ]);
    const events = ['picked_up','in_transit','delivered'];
    const count = events.indexOf(status)+1;
    for (let index=0;index<count;index++) {
      // Завершённая история датирована после создания заказа; активные события уже произошли сегодня.
      const eventDate = completed ? new Date(createdAt.getTime()+(index+1)*86_400_000) : new Date(now.getTime()-(count-index)*60_000);
      await client.query('INSERT INTO delivery_events(id,delivery_id,actor_id,status,created_at) VALUES($1,$2,$3,$4,$5)',[id(`${key}-event-${events[index]}`),deliveryId,id('driver'),events[index],eventDate]);
    }
  }
}
