import { Controller, Get, Post, Patch, Param, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Db } from '../db';
import { ApiError, dateField, positiveInt, requireRole, textField, uuidField } from '../security';
import { calculateTiles, calculatePaint, calculateDryMix } from '../calculators';

@Controller('api/v1')
export class ProjectsController {
  constructor(private readonly db: Db) {}

  @Get('projects') async projects(@Req() request: Request) {
    const user = requireRole(await this.db.user(request.cookies?.om_session),'buyer');
    return this.db.rows('SELECT id,name,address,stages,created_at AS "createdAt" FROM projects WHERE buyer_id=$1 ORDER BY created_at DESC',[user.id]);
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
    const items = await this.db.rows('SELECT i.id,i.product_id AS "productId",p.name AS "productName",p.unit,i.quantity,i.stage_date AS "stageDate" FROM project_items i JOIN products p ON p.id=i.product_id WHERE i.project_id=$1 ORDER BY i.stage_date NULLS LAST,p.name',[id]);
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
    return this.db.one('INSERT INTO project_items(project_id,product_id,quantity,stage_date) VALUES($1,$2,$3,$4) RETURNING id,product_id AS "productId",quantity,stage_date AS "stageDate"',[id,productId,positiveInt(body.quantity,'quantity'),dateField(body.stageDate,'stageDate')]);
  }

  @Post('calculators/tiles') tiles(@Body() body: Record<string,unknown>) { return calculateTiles(body); }
  @Post('calculators/paint') paint(@Body() body: Record<string,unknown>) { return calculatePaint(body); }
  @Post('calculators/dry-mix') dryMix(@Body() body: Record<string,unknown>) { return calculateDryMix(body); }
}
