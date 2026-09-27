import { Controller, Get, Post, Patch, Param, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Db } from '../db';
import { ApiError, requireRole, textField, uuidField } from '../security';

function slug(value: unknown): string {
  const result=textField(value,'slug',100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new ApiError(400,'invalid_input','slug: используйте латинские буквы, цифры и дефисы');
  return result;
}
function imageUrl(value: unknown): string | null {
  if (value == null || value==='') return null;
  const url=textField(value,'imageUrl',500);
  if (!/^https:\/\//.test(url) && !url.startsWith('/images/')) throw new ApiError(400,'invalid_input','imageUrl: нужен HTTPS URL или локальный путь /images/');
  return url;
}
function specs(value: unknown): string {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ApiError(400,'invalid_input','specs: требуется объект');
  const json=JSON.stringify(value);
  if (json.length>5000) throw new ApiError(400,'invalid_input','specs: слишком большой объект');
  return json;
}

@Controller('api/v1')
export class AdminController {
  constructor(private readonly db: Db) {}

  @Get('supplier/warehouses') async warehouses(@Req() request: Request) {
    const user=requireRole(await this.db.user(request.cookies?.om_session),'supplier');
    return this.db.rows('SELECT w.id,w.name,w.address,w.lon,w.lat FROM warehouses w JOIN suppliers s ON s.id=w.supplier_id WHERE s.owner_id=$1 ORDER BY w.name',[user.id]);
  }

  @Post('admin/categories') async addCategory(@Req() request: Request,@Body() body: Record<string,unknown>) {
    requireRole(await this.db.user(request.cookies?.om_session),'admin');
    return this.db.one('INSERT INTO categories(name,slug) VALUES($1,$2) RETURNING id,name,slug',[textField(body.name,'name',100),slug(body.slug)]);
  }

  @Patch('admin/categories/:id') async editCategory(@Req() request: Request,@Param('id') id:string,@Body() body:Record<string,unknown>) {
    requireRole(await this.db.user(request.cookies?.om_session),'admin');
    uuidField(id,'id');
    const columns:string[]=[];const values:unknown[]=[];
    if (body.name!==undefined) {values.push(textField(body.name,'name',100));columns.push(`name=$${values.length}`);}
    if (body.slug!==undefined) {values.push(slug(body.slug));columns.push(`slug=$${values.length}`);}
    if (!columns.length) throw new ApiError(400,'invalid_input','Нет полей для изменения');
    values.push(id);
    const result=await this.db.one(`UPDATE categories SET ${columns.join(',')} WHERE id=$${values.length} RETURNING id,name,slug`,values);
    if (!result) throw new ApiError(404,'not_found','Категория не найдена');
    return result;
  }

  @Post('admin/products') async addProduct(@Req() request: Request,@Body() body:Record<string,unknown>) {
    requireRole(await this.db.user(request.cookies?.om_session),'admin');
    const categoryId=uuidField(body.categoryId,'categoryId');
    if (!await this.db.one('SELECT id FROM categories WHERE id=$1',[categoryId])) throw new ApiError(404,'not_found','Категория не найдена');
    return this.db.one('INSERT INTO products(category_id,slug,name,unit,image_url,description,specs) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[categoryId,slug(body.slug),textField(body.name,'name',200),textField(body.unit,'unit',30),imageUrl(body.imageUrl),typeof body.description==='string'?body.description.slice(0,2000):'',specs(body.specs??{})]);
  }

  @Patch('admin/products/:id') async editProduct(@Req() request: Request,@Param('id') id:string,@Body() body:Record<string,unknown>) {
    requireRole(await this.db.user(request.cookies?.om_session),'admin');
    uuidField(id,'id');
    const columns:string[]=[];const values:unknown[]=[];
    const add=(column:string,value:unknown)=>{values.push(value);columns.push(`${column}=$${values.length}`);};
    if (body.categoryId!==undefined) add('category_id',uuidField(body.categoryId,'categoryId'));
    if (body.slug!==undefined) add('slug',slug(body.slug));
    if (body.name!==undefined) add('name',textField(body.name,'name',200));
    if (body.unit!==undefined) add('unit',textField(body.unit,'unit',30));
    if (body.imageUrl!==undefined) add('image_url',imageUrl(body.imageUrl));
    if (body.description!==undefined) add('description',textField(body.description,'description',2000));
    if (body.specs!==undefined) add('specs',specs(body.specs));
    if (!columns.length) throw new ApiError(400,'invalid_input','Нет полей для изменения');
    values.push(id);
    const result=await this.db.one(`UPDATE products SET ${columns.join(',')} WHERE id=$${values.length} RETURNING *`,values);
    if (!result) throw new ApiError(404,'not_found','Товар не найден');
    return result;
  }
}
