import { Controller, Get, Post, Patch, Param, Query, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Db } from '../db';
import { ApiError, positiveInt, nonnegativeInt, requireRole, uuidField } from '../security';

@Controller('api/v1')
export class CatalogController {
  constructor(private readonly db: Db) {}

  @Get('categories') categories() { return this.db.rows('SELECT id,name,slug FROM categories ORDER BY name'); }

  @Get('products') async products(@Query() query: Record<string,string>) {
    const page = Math.min(1000,Math.max(1,Number(query.page)||1));
    const limit = Math.min(100,Math.max(1,Number(query.limit)||20));
    const q = (query.q || '').trim().slice(0,100);
    const category = (query.category || '').trim();
    const sort = query.sort || 'name';
    const sortSql: Record<string,string> = {name:'p.name ASC',price_asc:'price_from_kopecks ASC NULLS LAST',price_desc:'price_from_kopecks DESC NULLS LAST'};
    if (!sortSql[sort]) throw new ApiError(400,'invalid_input','Неизвестная сортировка');
    const filter = "WHERE ($1='' OR p.name ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%') AND ($2='' OR c.slug=$2 OR c.id::text=$2)";
    const total = await this.db.one<{count:string}>(`SELECT count(*)::text AS count FROM products p JOIN categories c ON c.id=p.category_id ${filter}`,[q,category]);
    const items = await this.db.rows(`SELECT p.id,p.slug,p.name,p.category_id AS "categoryId",c.name AS category,p.unit,p.image_url AS "imageUrl",p.description,p.specs,min(o.price_kopecks)::int AS "priceFromKopecks" FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN offers o ON o.product_id=p.id AND o.active ${filter} GROUP BY p.id,c.name ORDER BY ${sortSql[sort]} LIMIT $3 OFFSET $4`,[q,category,limit,(page-1)*limit]);
    return {items,page,total:Number(total?.count||0)};
  }

  @Get('products/:id') async product(@Param('id') id: string) {
    const product = await this.db.one('SELECT p.id,p.slug,p.name,p.category_id AS "categoryId",c.name AS category,p.unit,p.image_url AS "imageUrl",p.description,p.specs FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id::text=$1 OR p.slug=$1',[id]);
    if (!product) throw new ApiError(404,'not_found','Товар не найден');
    const offers = await this.db.rows('SELECT o.id,o.supplier_id AS "supplierId",s.name AS "supplierName",o.warehouse_id AS "warehouseId",w.name AS "warehouseName",o.price_kopecks AS "priceKopecks",o.stock,o.delivery_days AS "deliveryDays",o.delivery_cost_kopecks AS "deliveryCostKopecks" FROM offers o JOIN suppliers s ON s.id=o.supplier_id JOIN warehouses w ON w.id=o.warehouse_id WHERE o.product_id=$1 AND o.active ORDER BY o.price_kopecks',[product.id]);
    return {...product,offers};
  }

  @Get('supplier/offers') async supplierOffers(@Req() request: Request) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'supplier');
    return this.db.rows('SELECT o.id,o.product_id AS "productId",p.name AS "productName",o.warehouse_id AS "warehouseId",o.price_kopecks AS "priceKopecks",o.stock,o.delivery_days AS "deliveryDays",o.delivery_cost_kopecks AS "deliveryCostKopecks",o.active FROM offers o JOIN suppliers s ON s.id=o.supplier_id JOIN products p ON p.id=o.product_id WHERE s.owner_id=$1 ORDER BY p.name',[user.id]);
  }

  @Post('supplier/offers') async addOffer(@Req() request: Request,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'supplier');
    const supplier = await this.db.one<{id:string}>('SELECT id FROM suppliers WHERE owner_id=$1',[user.id]);
    if (!supplier) throw new ApiError(403,'forbidden','Поставщик не найден');
    const productId = uuidField(body.productId,'productId');
    const warehouseId = uuidField(body.warehouseId,'warehouseId');
    if (!await this.db.one('SELECT id FROM warehouses WHERE id=$1 AND supplier_id=$2',[warehouseId,supplier.id])) throw new ApiError(403,'forbidden','Склад не принадлежит поставщику');
    const offer = await this.db.one('INSERT INTO offers(product_id,supplier_id,warehouse_id,price_kopecks,stock,delivery_days,delivery_cost_kopecks) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[productId,supplier.id,warehouseId,positiveInt(body.priceKopecks,'priceKopecks'),nonnegativeInt(body.stock,'stock'),nonnegativeInt(body.deliveryDays,'deliveryDays'),nonnegativeInt(body.deliveryCostKopecks,'deliveryCostKopecks')]);
    return offer;
  }

  @Patch('supplier/offers/:id') async editOffer(@Req() request: Request,@Param('id') id: string,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'supplier');
    uuidField(id,'id');
    const existing = await this.db.one('SELECT o.id FROM offers o JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=$1 AND s.owner_id=$2',[id,user.id]);
    if (!existing) throw new ApiError(404,'not_found','Предложение не найдено');
    const allowed = ['priceKopecks','stock','deliveryDays','deliveryCostKopecks','active'] as const;
    const values: unknown[]=[]; const sets: string[]=[];
    const columns = {priceKopecks:'price_kopecks',stock:'stock',deliveryDays:'delivery_days',deliveryCostKopecks:'delivery_cost_kopecks',active:'active'};
    for (const key of allowed) if (body[key] !== undefined) {
      const value = key==='active' ? body[key] : key==='priceKopecks' ? positiveInt(body[key],key) : nonnegativeInt(body[key],key);
      if (key==='active' && typeof value !== 'boolean') throw new ApiError(400,'invalid_input','active: требуется логическое значение');
      values.push(value); sets.push(`${columns[key]}=$${values.length}`);
    }
    if (!sets.length) throw new ApiError(400,'invalid_input','Нет полей для изменения');
    values.push(id);
    return this.db.one(`UPDATE offers SET ${sets.join(',')} WHERE id=$${values.length} RETURNING *`,values);
  }
}
