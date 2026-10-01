import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { ProjectsController } from '../src/routes/projects';
import type { Db } from '../src/db';
import { ApiError, dateField } from '../src/security';

const id='11111111-1111-1111-1111-111111111111';
const invalidInput=(error: unknown)=>error instanceof ApiError && error.status===400 && error.code==='invalid_input';

test('ручная потребность проверяет границу PostgreSQL integer до INSERT и UPDATE',async()=>{
  const writes: unknown[][]=[];
  const db={
    user:async()=>({id,role:'buyer'}),
    mustOwnProject:async()=>{},
    one:async(sql:string,params:unknown[])=>{
      if (/^(INSERT|UPDATE)/.test(sql)) writes.push(params);
      return {id};
    },
  } as unknown as Db;
  const controller=new ProjectsController(db);
  const request={cookies:{}} as Request;
  for (const quantity of [1,2147483647]) {
    await controller.addItem(request,id,{productId:id,quantity});
    assert.equal(writes.at(-1)![2],quantity);
    await controller.editItem(request,id,id,{quantity});
    assert.equal(writes.at(-1)![0],quantity);
  }
  const count=writes.length;
  for (const quantity of [2147483648,Number.MAX_SAFE_INTEGER,0,-1,1.5,'2',Infinity]) {
    await assert.rejects(controller.addItem(request,id,{productId:id,quantity}),invalidInput);
    await assert.rejects(controller.editItem(request,id,id,{quantity}),invalidInput);
  }
  assert.equal(writes.length,count,'недопустимое количество не попадает в SQL изменения');
});

test('даты SQL исключают год 0000 и сохраняют календарные и nullable правила всех полей',()=>{
  for (const field of ['stageDate','requestedDate','scheduledDate']) {
    for (const value of [undefined,null,'']) assert.equal(dateField(value,field),null);
    for (const value of ['0001-01-01','0099-12-31','2000-02-29','2028-02-29','9999-12-31']) assert.equal(dateField(value,field),value);
    for (const value of ['0000-01-01','0000-02-29','1900-02-29','2026-02-29','2026-02-30','2026-13-01','2026-01-00','2026-1-01',123]) assert.throws(()=>dateField(value,field),invalidInput);
  }
});
