import { Controller, Get, Post, Patch, Delete, HttpCode, Param, Body, Req, Headers } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Db } from '../db';
import { ApiError, dateField, positiveInt, requireRole, textField, uuidField } from '../security';
import { calculateTiles, calculatePaint, calculateDryMix } from '../calculators';
import { calculateMaterial, MaterialProduct, normalizeMaterialRequest } from '../packaging';

function projectQuantity(value: unknown): number {
  // Предел поля project_items.quantity в PostgreSQL.
  const quantity = positiveInt(value,'quantity');
  if (quantity > 2147483647) throw new ApiError(400,'invalid_input','quantity: допускается не больше 2147483647');
  return quantity;
}

@Controller('api/v1')
export class ProjectsController {
  constructor(private readonly db: Db) {}

  @Get('projects') async projects(@Req() request: Request) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    return this.db.rows('SELECT p.id,p.name,p.address,p.stages,p.created_at AS "createdAt",(SELECT COUNT(*)::int FROM project_items i WHERE i.project_id=p.id) AS "itemCount" FROM projects p WHERE p.buyer_id=$1 ORDER BY p.created_at DESC',[user.id]);
  }

  @Post('projects') async addProject(@Req() request: Request,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    const stages = body.stages ?? [];
    if (!Array.isArray(stages) || stages.length>50) throw new ApiError(400,'invalid_input','Некорректные этапы объекта');
    return this.db.one('INSERT INTO projects(buyer_id,name,address,stages) VALUES($1,$2,$3,$4) RETURNING id,name,address,stages',[user.id,textField(body.name,'name',150),textField(body.address,'address',300),JSON.stringify(stages)]);
  }

  @Get('projects/:id') async project(@Req() request: Request,@Param('id') id: string) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id');
    const project = await this.db.one('SELECT id,name,address,stages,created_at AS "createdAt" FROM projects WHERE id=$1 AND buyer_id=$2',[id,user.id]);
    if (!project) throw new ApiError(404,'not_found','Объект не найден');
    const items = await this.db.rows(`SELECT i.id,i.product_id AS "productId",p.name AS "productName",p.unit,i.quantity,to_char(i.stage_date,'YYYY-MM-DD') AS "stageDate" FROM project_items i JOIN products p ON p.id=i.product_id WHERE i.project_id=$1 ORDER BY i.stage_date NULLS LAST,p.name`,[id]);
    return {...project,items};
  }

  @Patch('projects/:id') async editProject(@Req() request: Request,@Param('id') id: string,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id');
    await this.db.mustOwnProject(id,user.id);
    const values: unknown[]=[]; const sets: string[]=[];
    for (const key of ['name','address'] as const) if (body[key] !== undefined) { values.push(textField(body[key],key,key==='name'?150:300)); sets.push(`${key}=$${values.length}`); }
    if (body.stages !== undefined) { if (!Array.isArray(body.stages) || body.stages.length>50) throw new ApiError(400,'invalid_input','Некорректные этапы объекта'); values.push(JSON.stringify(body.stages)); sets.push(`stages=$${values.length}`); }
    if (!sets.length) throw new ApiError(400,'invalid_input','Нет полей для изменения');
    values.push(id);
    return this.db.one(`UPDATE projects SET ${sets.join(',')} WHERE id=$${values.length} RETURNING id,name,address,stages`,values);
  }

  @Post('projects/:id/items') async addItem(@Req() request: Request,@Param('id') id: string,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id');
    await this.db.mustOwnProject(id,user.id);
    const productId = uuidField(body.productId,'productId');
    if (!await this.db.one('SELECT id FROM products WHERE id=$1',[productId])) throw new ApiError(404,'not_found','Товар не найден');
    return this.db.one(`INSERT INTO project_items(project_id,product_id,quantity,stage_date) VALUES($1,$2,$3,$4) RETURNING id,product_id AS "productId",quantity,to_char(stage_date,'YYYY-MM-DD') AS "stageDate"`,[id,productId,projectQuantity(body.quantity),dateField(body.stageDate,'stageDate')]);
  }

  @Patch('projects/:id/items/:itemId') async editItem(@Req() request: Request,@Param('id') id: string,@Param('itemId') itemId: string,@Body() body: Record<string,unknown>) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id'); uuidField(itemId,'itemId');
    if (!await this.db.one('SELECT i.id FROM project_items i JOIN projects p ON p.id=i.project_id WHERE i.id=$1 AND i.project_id=$2 AND p.buyer_id=$3',[itemId,id,user.id])) throw new ApiError(404,'not_found','Позиция не найдена');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key)=>!['quantity','stageDate'].includes(key))) throw new ApiError(400,'invalid_input','Разрешено изменить только количество и дату этапа');
    const values: unknown[]=[]; const sets: string[]=[];
    if (body.quantity !== undefined) { values.push(projectQuantity(body.quantity)); sets.push(`quantity=$${values.length}`); }
    if (body.stageDate !== undefined) { values.push(dateField(body.stageDate,'stageDate')); sets.push(`stage_date=$${values.length}`); }
    if (!sets.length) throw new ApiError(400,'invalid_input','Нет полей для изменения');
    values.push(itemId,id,user.id);
    const item=await this.db.one(`UPDATE project_items i SET ${sets.join(',')} WHERE i.id=$${values.length-2} AND i.project_id=$${values.length-1} AND EXISTS (SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.buyer_id=$${values.length}) RETURNING i.id,i.product_id AS "productId",i.quantity,to_char(i.stage_date,'YYYY-MM-DD') AS "stageDate"`,values);
    if (!item) throw new ApiError(404,'not_found','Позиция не найдена');
    return item;
  }

  @Delete('projects/:id/items/:itemId') @HttpCode(204) async removeItem(@Req() request: Request,@Param('id') id: string,@Param('itemId') itemId: string) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    uuidField(id,'id'); uuidField(itemId,'itemId');
    const item=await this.db.one('DELETE FROM project_items i WHERE i.id=$1 AND i.project_id=$2 AND EXISTS (SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.buyer_id=$3) RETURNING i.id',[itemId,id,user.id]);
    if (!item) throw new ApiError(404,'not_found','Позиция не найдена');
  }

  @Post('projects/:id/items/from-calculation') async addFromCalculation(@Req() request:Request,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key?:string) {
    const user=requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    id=uuidField(id,'id').toLowerCase();
    if (!key || key.length>100 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new ApiError(400,'idempotency_key_required','Укажите Idempotency-Key (1–100 букв, цифр или ._:-)');
    const normalized=normalizeMaterialRequest(body,true);
    const hash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return this.db.transaction(async client=>{
      // Блокировка ключа сериализует проверку результата и конкурентные повторы.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`project-calculation:${id}:${key}`]);
      if (!(await client.query('SELECT id FROM projects WHERE id=$1 AND buyer_id=$2 FOR KEY SHARE',[id,user.id])).rowCount) throw new ApiError(404,'not_found','Объект не найден');
      const prior=(await client.query<{request_hash:string;item_id:string;response:unknown}>('SELECT request_hash,item_id,response FROM project_calculation_keys WHERE project_id=$1 AND key=$2',[id,key])).rows[0];
      if (prior) {
        if (prior.request_hash!==hash) throw new ApiError(409,'idempotency_conflict','Ключ уже использован для другого расчёта');
        if (!(await client.query('SELECT id FROM project_items WHERE id=$1 AND project_id=$2 FOR KEY SHARE',[prior.item_id,id])).rowCount) throw new ApiError(409,'calculation_item_deleted','Позиция этого расчёта удалена; для нового добавления нужен новый ключ');
        return prior.response;
      }
      const product=(await client.query<MaterialProduct>('SELECT id,name,unit,packaging FROM products WHERE id=$1',[normalized.productId])).rows[0];
      if (!product) throw new ApiError(404,'not_found','Товар не найден');
      const calculation=calculateMaterial(product,normalized);
      const inserted=(await client.query('INSERT INTO project_items(project_id,product_id,quantity,stage_date) VALUES($1,$2,$3,$4) RETURNING id,product_id AS "productId",quantity,to_char(stage_date,\'YYYY-MM-DD\') AS "stageDate"',[id,product.id,calculation.packages,normalized.stageDate])).rows[0];
      const response={item:{...inserted,productName:product.name,unit:product.unit},calculation};
      await client.query('INSERT INTO project_calculation_keys(project_id,key,request_hash,item_id,response) VALUES($1,$2,$3,$4,$5)',[id,key,hash,inserted.id,JSON.stringify(response)]);
      return response;
    });
  }

  @Post('calculators/material') async material(@Body() body:unknown) {
    const normalized=normalizeMaterialRequest(body);
    const product=await this.db.one<MaterialProduct>('SELECT id,name,unit,packaging FROM products WHERE id=$1',[normalized.productId]);
    if (!product) throw new ApiError(404,'not_found','Товар не найден');
    return calculateMaterial(product,normalized);
  }

  @Post('calculators/tiles') tiles(@Body() body: Record<string,unknown>) { return calculateTiles(body); }
  @Post('calculators/paint') paint(@Body() body: Record<string,unknown>) { return calculatePaint(body); }
  @Post('calculators/dry-mix') dryMix(@Body() body: Record<string,unknown>) { return calculateDryMix(body); }
}
