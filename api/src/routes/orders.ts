import { Controller, Get, Post, Param, Body, Req, Headers } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { Db } from '../db';
import { earliestDateInAstrakhan, todayInAstrakhan } from '../calendar-date';
import { normalizeOrderMoney } from '../order-money';
import { ApiError, dateField, positiveInt, requireRole, textField, uuidField } from '../security';

type CartItem = { offerId: string; quantity: number };
type Offer = { id:string; supplier_id:string; supplier_name:string; product_name:string; unit:string; price_kopecks:number; stock:number; delivery_days:number; delivery_cost_kopecks:number; active:boolean };

export function parseItems(value: unknown): CartItem[] {
  if (!Array.isArray(value) || !value.length || value.length>50) throw new ApiError(400,'invalid_input','Корзина должна содержать от 1 до 50 позиций');
  const aggregated = new Map<string,number>();
  for (const row of value) {
    if (!row || typeof row !== 'object') throw new ApiError(400,'invalid_input','Некорректная позиция');
    const item = row as Record<string,unknown>;
    const offerId = uuidField(item.offerId,'offerId');
    const quantity = positiveInt(item.quantity,'quantity');
    if (quantity>10000) throw new ApiError(400,'invalid_input','Количество превышает ограничение');
    const total = (aggregated.get(offerId)||0)+quantity;
    if (total>10000) throw new ApiError(400,'invalid_input','Количество превышает ограничение');
    aggregated.set(offerId,total);
  }
  return [...aggregated].map(([offerId,quantity])=>({offerId,quantity})).sort((a,b)=>a.offerId.localeCompare(b.offerId));
}

// Учебная зона ограничена адресами города Астрахани в формате «Астрахань, улица, дом».
export function inDemoZone(address: string): boolean { return /^(?:г\.?\s*)?астрахань\s*,\s*\S.+$/iu.test(address.trim()); }

export function getTotals(items: CartItem[], offers: Offer[]) {
  const offerMap = new Map(offers.map((o)=>[o.id,o]));
  const unavailable: Array<{offerId:string;reason:string}> = [];
  const lines = items.map((item)=>{
    const offer = offerMap.get(item.offerId);
    if (!offer || !offer.active) { unavailable.push({offerId:item.offerId,reason:'Предложение недоступно'}); return null; }
    if (offer.stock<item.quantity) unavailable.push({offerId:item.offerId,reason:`На складе только ${offer.stock}`});
    return {offerId:item.offerId,quantity:item.quantity,productName:offer.product_name,unit:offer.unit,supplierId:offer.supplier_id,supplierName:offer.supplier_name,priceKopecks:offer.price_kopecks,lineTotalKopecks:offer.price_kopecks*item.quantity,stock:offer.stock,deliveryDays:offer.delivery_days,deliveryCostKopecks:offer.delivery_cost_kopecks};
  }).filter((line):line is NonNullable<typeof line>=>line!==null);
  const deliveryBySupplier = new Map<string,number>();
  for (const line of lines) deliveryBySupplier.set(line.supplierId,Math.max(deliveryBySupplier.get(line.supplierId)||0,line.deliveryCostKopecks));
  const itemsTotalKopecks = lines.reduce((sum,line)=>sum+line.lineTotalKopecks,0);
  const deliveryTotalKopecks = [...deliveryBySupplier.values()].reduce((sum,cost)=>sum+cost,0);
  return {lines,itemsTotalKopecks,deliveryTotalKopecks,totalKopecks:itemsTotalKopecks+deliveryTotalKopecks,unavailable,deliveryBySupplier};
}

@Controller('api/v1')
export class OrdersController {
  constructor(private readonly db: Db) {}

  private async releaseReservation(client: PoolClient, orderId: string, status: 'cancelled'|'expired') {
    const items=await client.query<{offer_id:string;quantity:number}>('SELECT offer_id,sum(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY offer_id ORDER BY offer_id',[orderId]);
    for (const item of items.rows) await client.query('UPDATE offers SET stock=stock+$1 WHERE id=$2',[item.quantity,item.offer_id]);
    await client.query("UPDATE deliveries SET status='cancelled' WHERE order_id=$1 AND status IN ('pending','assigned')",[orderId]);
    await client.query('UPDATE orders SET status=$1 WHERE id=$2',[status,orderId]);
  }

  private async expireReservations() {
    await this.db.transaction(async(client)=>{
      const expired=await client.query<{id:string}>("SELECT id FROM orders WHERE status='awaiting_payment' AND reservation_expires_at<=now() ORDER BY reservation_expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED");
      for (const order of expired.rows) await this.releaseReservation(client,order.id,'expired');
    });
  }

  private async offers(ids: string[], client?: PoolClient): Promise<Offer[]> {
    const db = client ?? this.db.pool;
    const lock = client ? ' FOR UPDATE OF o' : '';
    return (await db.query<Offer>(`SELECT o.id,o.supplier_id,s.name AS supplier_name,p.name AS product_name,p.unit,o.price_kopecks,o.stock,o.delivery_days,o.delivery_cost_kopecks,o.active FROM offers o JOIN suppliers s ON s.id=o.supplier_id JOIN products p ON p.id=o.product_id WHERE o.id=ANY($1::uuid[]) ORDER BY o.id${lock}`,[ids])).rows;
  }

  @Post('quotes') async quote(@Body() body: Record<string,unknown>) {
    await this.expireReservations();
    const items = parseItems(body.items);
    const address = textField(body.address,'address',300);
    const requestedDate = dateField(body.requestedDate,'requestedDate');
    const result = getTotals(items,await this.offers(items.map((i)=>i.offerId)));
    const warnings: string[]=[];
    if (!inDemoZone(address)) warnings.push('Демонстрационная зона доставки ограничена Астраханью');
    const now = new Date();
    if (requestedDate && requestedDate < todayInAstrakhan(now)) warnings.push('Запрошенная дата уже прошла');
    if (requestedDate) for (const line of result.lines) {
      const earliest = earliestDateInAstrakhan(line.deliveryDays,now);
      if (requestedDate < earliest) warnings.push(`${line.productName}: ближайшая дата поставки ${earliest}`);
    }
    return {lines:result.lines.map(line=>({...line,earliestDeliveryDate:earliestDateInAstrakhan(line.deliveryDays,now)})),itemsTotalKopecks:result.itemsTotalKopecks,deliveryTotalKopecks:result.deliveryTotalKopecks,totalKopecks:result.totalKopecks,unavailable:result.unavailable,warnings,source:'demo',deliveryZone:'demo-astrakhan',zoneAvailable:inDemoZone(address),pricingNote:'Доставка считается один раз для каждого поставщика по максимальной ставке его предложений'};
  }

  @Post('orders') async create(@Req() request: Request,@Body() body: Record<string,unknown>,@Headers('idempotency-key') key?: string) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    if (!key || key.length>100 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new ApiError(400,'idempotency_key_required','Укажите Idempotency-Key (1–100 букв, цифр или ._:-)');
    await this.expireReservations();
    const items = parseItems(body.items);
    const address = textField(body.address,'address',300);
    if (!inDemoZone(address)) throw new ApiError(400,'delivery_zone','Демонстрационная доставка доступна только в Астрахани');
    const requestedDate = dateField(body.requestedDate,'requestedDate');
    const projectId = body.projectId == null ? null : uuidField(body.projectId,'projectId');
    if (projectId) await this.db.mustOwnProject(projectId,user.id);
    const requestHash = createHash('sha256').update(JSON.stringify({items,address,requestedDate,projectId})).digest('hex');
    const orderId = await this.db.transaction(async (client)=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${user.id}:${key}`]);
      const prior = await client.query<{request_hash:string;order_id:string}>('SELECT request_hash,order_id FROM idempotency_keys WHERE buyer_id=$1 AND key=$2',[user.id,key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash!==requestHash) throw new ApiError(409,'idempotency_conflict','Ключ уже использован для другого заказа');
        return prior.rows[0].order_id;
      }
      const now = new Date();
      if (requestedDate && requestedDate < todayInAstrakhan(now)) throw new ApiError(400,'invalid_date','Дата доставки уже прошла');
      const offers = await this.offers(items.map((i)=>i.offerId),client);
      const totals = getTotals(items,offers);
      if (totals.unavailable.length) throw new ApiError(409,'stock_unavailable',`Позиции недоступны: ${totals.unavailable.map((row)=>row.offerId).join(', ')}`);
      if (requestedDate && totals.lines.some((line)=>requestedDate<earliestDateInAstrakhan(line.deliveryDays,now))) throw new ApiError(409,'delivery_date_unavailable','Запрошенная дата раньше доступного срока поставки');
      const created = await client.query<{id:string}>("INSERT INTO orders(buyer_id,project_id,address,requested_date,items_total_kopecks,delivery_total_kopecks,reservation_expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 minutes') RETURNING id",[user.id,projectId,address,requestedDate,totals.itemsTotalKopecks,totals.deliveryTotalKopecks]);
      const id = created.rows[0].id;
      for (const line of totals.lines) {
        await client.query('UPDATE offers SET stock=stock-$1 WHERE id=$2',[line.quantity,line.offerId]);
        await client.query('INSERT INTO order_items(order_id,offer_id,supplier_id,product_name,unit,quantity,price_kopecks) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,line.offerId,line.supplierId,line.productName,line.unit,line.quantity,line.priceKopecks]);
      }
      for (const [supplierId,cost] of totals.deliveryBySupplier) await client.query('INSERT INTO deliveries(order_id,supplier_id,delivery_cost_kopecks,route) VALUES($1,$2,$3,$4)',[id,supplierId,cost,JSON.stringify([[48.033,46.35],[48.045,46.36],[48.055,46.37]])]);
      await client.query('INSERT INTO idempotency_keys(buyer_id,key,request_hash,order_id) VALUES($1,$2,$3,$4)',[user.id,key,requestHash,id]);
      return id;
    });
    return this.order(request,orderId);
  }

  @Get('orders') async orders(@Req() request: Request) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    await this.expireReservations();
    const orders = await this.db.rows(`SELECT id,address,to_char(requested_date,'YYYY-MM-DD') AS "requestedDate",reservation_expires_at AS "reservationExpiresAt",status,items_total_kopecks AS "itemsTotalKopecks",delivery_total_kopecks AS "deliveryTotalKopecks",(items_total_kopecks+delivery_total_kopecks) AS "totalKopecks",created_at AS "createdAt" FROM orders WHERE buyer_id=$1 ORDER BY created_at DESC`,[user.id]);
    return orders.map(normalizeOrderMoney);
  }

  @Get('orders/:id') async order(@Req() request: Request,@Param('id') id: string) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id');
    await this.expireReservations();
    const order = await this.db.one(`SELECT id,address,to_char(requested_date,'YYYY-MM-DD') AS "requestedDate",reservation_expires_at AS "reservationExpiresAt",project_id AS "projectId",status,items_total_kopecks AS "itemsTotalKopecks",delivery_total_kopecks AS "deliveryTotalKopecks",(items_total_kopecks+delivery_total_kopecks) AS "totalKopecks",created_at AS "createdAt" FROM orders WHERE id=$1 AND buyer_id=$2`,[id,user.id]);
    if (!order) throw new ApiError(404,'not_found','Заказ не найден');
    const items = await this.db.rows('SELECT i.id,i.offer_id AS "offerId",i.supplier_id AS "supplierId",s.name AS "supplierName",i.product_name AS "productName",i.quantity,i.unit,i.price_kopecks AS "priceKopecks" FROM order_items i JOIN suppliers s ON s.id=i.supplier_id WHERE i.order_id=$1',[id]);
    const deliveries = await this.db.rows(`SELECT d.id,d.supplier_id AS "supplierId",s.name AS "supplierName",d.driver_id AS "driverId",d.status,to_char(d.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",d.route,d.delivery_cost_kopecks AS "deliveryCostKopecks" FROM deliveries d JOIN suppliers s ON s.id=d.supplier_id WHERE d.order_id=$1`,[id]);
    return {...normalizeOrderMoney(order),items,deliveries,paymentMode:'demo',trackingMode:'demo'};
  }

  @Post('orders/:id/demo-payment') async pay(@Req() request: Request,@Param('id') id: string) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id');
    const outcome=await this.db.transaction(async(client)=>{
      const result = await client.query<{status:string;reservation_expires_at:Date}>('SELECT status,reservation_expires_at FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE',[id,user.id]);
      if (!result.rows[0]) throw new ApiError(404,'not_found','Заказ не найден');
      if (result.rows[0].status==='awaiting_payment' && result.rows[0].reservation_expires_at<=new Date()) {
        await this.releaseReservation(client,id,'expired');
        return 'expired';
      }
      if (result.rows[0].status==='awaiting_payment') { await client.query("UPDATE orders SET status='paid' WHERE id=$1",[id]); return 'paid'; }
      return result.rows[0].status;
    });
    if (outcome==='expired' || outcome==='cancelled') throw new ApiError(409,'reservation_unavailable','Резерв заказа завершён');
    return this.order(request,id);
  }

  @Post('orders/:id/cancel') async cancel(@Req() request: Request,@Param('id') id: string) {
    const user=requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id');
    const outcome=await this.db.transaction(async(client)=>{
      const result=await client.query<{status:string;reservation_expires_at:Date}>('SELECT status,reservation_expires_at FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE',[id,user.id]);
      if (!result.rows[0]) throw new ApiError(404,'not_found','Заказ не найден');
      if (result.rows[0].status==='cancelled' || result.rows[0].status==='expired') return result.rows[0].status;
      if (result.rows[0].status!=='awaiting_payment') throw new ApiError(409,'cannot_cancel_paid','Оплаченный или выполняемый заказ нельзя отменить через этот метод');
      const status=result.rows[0].reservation_expires_at<=new Date()?'expired':'cancelled';
      await this.releaseReservation(client,id,status);
      return status;
    });
    return {...await this.order(request,id),cancellationStatus:outcome};
  }
}
