import { Controller, Get, Patch, Post, Param, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Db } from '../db';
import { ApiError, dateField, requireRole, uuidField } from '../security';

@Controller('api/v1')
export class OperationsController {
  constructor(private readonly db: Db) {}

  @Get('dispatch/drivers') async drivers(@Req() request: Request) {
    requireRole(await this.db.user(request.cookies?.om_session),'dispatcher','admin');
    return this.db.rows("SELECT id,name FROM users WHERE role='driver' ORDER BY name");
  }

  @Get('dispatch/deliveries') async dispatchDeliveries(@Req() request: Request) {
    requireRole(await this.db.user(request.cookies?.om_session),'dispatcher','admin');
    return this.db.rows(`SELECT d.id,d.order_id AS "orderId",d.supplier_id AS "supplierId",s.name AS "supplierName",d.driver_id AS "driverId",u.name AS "driverName",d.status,to_char(d.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",o.address,CASE WHEN o.destination_lon IS NULL THEN NULL ELSE jsonb_build_array(o.destination_lon,o.destination_lat) END AS "destinationCoordinates",o.status AS "orderStatus",d.route,d.departure_points AS "departurePoints" FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN users u ON u.id=d.driver_id ORDER BY d.scheduled_date NULLS LAST,o.created_at DESC`);
  }

  @Patch('dispatch/deliveries/:id') async assign(@Req() request: Request,@Param('id') id: string,@Body() body: Record<string,unknown>) {
    requireRole(await this.db.user(request.cookies?.om_session),'dispatcher','admin');
    uuidField(id,'id');
    const driverId = uuidField(body.driverId,'driverId');
    const scheduledDate = dateField(body.scheduledDate,'scheduledDate');
    if (!await this.db.one("SELECT id FROM users WHERE id=$1 AND role='driver'",[driverId])) throw new ApiError(400,'invalid_driver','Водитель не найден');
    return this.db.transaction(async(client)=>{
      const delivery = await client.query<{status:string;order_status:string}>('SELECT d.status,o.status AS order_status FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE d.id=$1 FOR UPDATE OF d',[id]);
      if (!delivery.rows[0]) throw new ApiError(404,'not_found','Поставка не найдена');
      if (delivery.rows[0].order_status==='awaiting_payment') throw new ApiError(409,'payment_required','Сначала подтвердите учебную оплату');
      if (!['pending','assigned'].includes(delivery.rows[0].status)) throw new ApiError(409,'invalid_status','Рейс уже выполняется');
      return (await client.query(`UPDATE deliveries SET driver_id=$1,scheduled_date=$2,status=$3 WHERE id=$4 RETURNING id,order_id AS "orderId",driver_id AS "driverId",to_char(scheduled_date,'YYYY-MM-DD') AS "scheduledDate",status`,[driverId,scheduledDate,'assigned',id])).rows[0];
    });
  }

  @Get('driver/deliveries') async driverDeliveries(@Req() request: Request) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'driver');
    // Снимок груза читается вместе с назначением рейса; цены и контакты покупателя не нужны водителю.
    return this.db.rows(`
      SELECT d.id,d.order_id AS "orderId",d.status,
        to_char(d.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",o.address,
        CASE WHEN o.destination_lon IS NULL THEN NULL
          ELSE jsonb_build_array(o.destination_lon,o.destination_lat) END AS "destinationCoordinates",
        d.route,d.departure_points AS "departurePoints",s.name AS "supplierName",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',i.id,'productName',i.product_name,'quantity',i.quantity,'unit',i.unit
          ) ORDER BY i.id)
          FROM order_items i
          WHERE i.order_id=d.order_id AND i.supplier_id=d.supplier_id
        ),'[]'::jsonb) AS items
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      JOIN suppliers s ON s.id=d.supplier_id
      WHERE d.driver_id=$1
      ORDER BY d.scheduled_date NULLS LAST
    `,[user.id]);
  }

  @Post('driver/deliveries/:id/events') async event(@Req() request: Request,@Param('id') id: string,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'driver');
    uuidField(id,'id');
    const next = body.status;
    const transitions: Record<string,string>={assigned:'picked_up',picked_up:'in_transit',in_transit:'delivered'};
    return this.db.transaction(async(client)=>{
      const assigned = await client.query<{order_id:string}>('SELECT order_id FROM deliveries WHERE id=$1 AND driver_id=$2',[id,user.id]);
      if (!assigned.rows[0]) throw new ApiError(404,'not_found','Рейс не найден');
      // Общая блокировка заказа упорядочивает события нескольких поставок.
      const order = await client.query<{status:string}>('SELECT status FROM orders WHERE id=$1 FOR UPDATE',[assigned.rows[0].order_id]);
      if (!order.rows[0] || !['paid','in_progress'].includes(order.rows[0].status)) throw new ApiError(409,'invalid_status','Заказ не готов к доставке');
      const result = await client.query<{status:string;order_id:string}>('SELECT status,order_id FROM deliveries WHERE id=$1 AND driver_id=$2 FOR UPDATE',[id,user.id]);
      const delivery = result.rows[0];
      if (!delivery) throw new ApiError(404,'not_found','Рейс не найден');
      if (transitions[delivery.status]!==next) throw new ApiError(409,'invalid_status','Недопустимый переход статуса');
      await client.query('UPDATE deliveries SET status=$1 WHERE id=$2',[next,id]);
      await client.query('INSERT INTO delivery_events(delivery_id,actor_id,status) VALUES($1,$2,$3)',[id,user.id,next]);
      if (next==='picked_up') await client.query("UPDATE orders SET status='in_progress' WHERE id=$1 AND status='paid'",[delivery.order_id]);
      if (next==='delivered') await client.query("UPDATE orders SET status='delivered' WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM deliveries WHERE order_id=$1 AND status<>'delivered')",[delivery.order_id]);
      return {id,status:next,trackingMode:'demo'};
    });
  }

  @Get('reports/summary') async summary(@Req() request: Request) {
    requireRole(await this.db.user(request.cookies?.om_session),'admin');
    const orders = await this.db.one('SELECT count(*)::int AS count,coalesce(sum(items_total_kopecks+delivery_total_kopecks),0)::text AS "totalKopecks" FROM orders');
    const deliveries = await this.db.rows('SELECT status,count(*)::int AS count FROM deliveries GROUP BY status ORDER BY status');
    return {orders,deliveries,mode:'demo',note:'Показатели рассчитаны по учебным данным; реальные платежи отсутствуют'};
  }
}
