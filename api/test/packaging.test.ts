import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMaterial, normalizeMaterialRequest, packagingField } from '../src/packaging';
import { ApiError } from '../src/security';

const id='8792387b-38d9-6321-198b-9f7850cfc617';
const invalid=(action:()=>unknown)=>assert.throws(action,(e:unknown)=>e instanceof ApiError && e.status===400);
const product=(packaging:unknown,unit='коробка')=>({id,name:'Тест',unit,packaging});

test('две фасовки плитки и покрытие берутся из товара',()=>{
  for (const [tileAreaM2,tilesPerPack,tiles,packages,coverage] of [[0.36,4,74,19,27.36],[0.18,7,147,21,26.46]]) {
    const result=calculateMaterial(product({kind:'tiles',tileAreaM2,tilesPerPack}),normalizeMaterialRequest({productId:id,kind:'tiles',inputs:{areaM2:24}}));
    assert.equal(result.calculatedConsumption,tiles); assert.equal(result.packages,packages); assert.ok(Math.abs(result.coverage-coverage)<1e-12); assert.equal(result.coverageUnit,'м²');
  }
  const exact=calculateMaterial(product({kind:'tiles',tileAreaM2:0.36,tilesPerPack:4}),normalizeMaterialRequest({productId:id,kind:'tiles',inputs:{areaM2:1.44,wastePercent:0}}));
  assert.equal(exact.packages,1);
});

test('краска и смесь округляют по выбранной фасовке',()=>{
  for (const packSizeL of [10,9]) assert.equal(calculateMaterial(product({kind:'paint',packSizeL},'ведро'),normalizeMaterialRequest({productId:id,kind:'paint',inputs:{areaM2:189,rateLPerM2:0.1,coats:1,wastePercent:0}})).packages,packSizeL===10?2:3);
  for (const [packSizeKg,count] of [[25,27],[30,22],[50,14]]) assert.equal(calculateMaterial(product({kind:'dry-mix',packSizeKg},'мешок'),normalizeMaterialRequest({productId:id,kind:'dry-mix',inputs:{areaM2:100,layerMm:6,rateKgPerM2Mm:1.1,wastePercent:0}})).packages,count);
});

test('фасовка nullable; неправильный вид, единица, поля и числа отвергаются',()=>{
  assert.equal(packagingField(null,'м²'),null);
  for (const value of [{kind:'unknown'},{kind:'tiles',tileAreaM2:0.36,tilesPerPack:1.5},{kind:'tiles',tileAreaM2:Infinity,tilesPerPack:4},{kind:'paint',packSizeL:0},{kind:'paint',packSizeL:10,extra:1}]) invalid(()=>packagingField(value,'коробка'));
  invalid(()=>packagingField({kind:'tiles',tileAreaM2:0.36,tilesPerPack:4},'м²'));
  const request=normalizeMaterialRequest({productId:id,kind:'tiles',inputs:{areaM2:24}});
  invalid(()=>calculateMaterial(product(null),request));
  invalid(()=>calculateMaterial(product({kind:'paint',packSizeL:10},'ведро'),request));
});

test('закрытые inputs не доверяют клиентской фасовке; null отличается от отсутствия',()=>{
  const body={productId:id,kind:'paint',inputs:{areaM2:24,rateLPerM2:0.1}};
  for (const extra of ['packSizeL','tileAreaM2','tilesPerPack','packages','packSize','anything']) invalid(()=>normalizeMaterialRequest({...body,inputs:{...body.inputs,[extra]:10}}));
  invalid(()=>normalizeMaterialRequest({...body,quantity:5}));
  for (const field of ['areaM2','rateLPerM2','coats','wastePercent']) invalid(()=>normalizeMaterialRequest({...body,inputs:{...body.inputs,[field]:null}}));
  assert.deepEqual(normalizeMaterialRequest({...body,productId:id.toUpperCase()},true),normalizeMaterialRequest({...body,inputs:{...body.inputs,wastePercent:10,coats:2},stageDate:null},true));
});
