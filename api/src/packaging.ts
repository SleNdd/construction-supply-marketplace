import { calculateDryMix, calculatePaint, calculateTiles } from './calculators';
import { ApiError, dateField, uuidField } from './security';

export type Packaging = {kind:'tiles';tileAreaM2:number;tilesPerPack:number} | {kind:'paint';packSizeL:number} | {kind:'dry-mix';packSizeKg:number};
export type MaterialProduct = {id:string;name:string;unit:string;packaging:unknown};
const fields = {tiles:['tileAreaM2','tilesPerPack'],paint:['packSizeL'],'dry-mix':['packSizeKg']} as const;
const units = {tiles:'коробка',paint:'ведро','dry-mix':'мешок'} as const;
const inputFields = {tiles:['areaM2','wastePercent'],paint:['areaM2','rateLPerM2','coats','wastePercent'],'dry-mix':['areaM2','layerMm','rateKgPerM2Mm','wastePercent']} as const;

function closedObject(value:unknown, allowed:readonly string[], label:string): Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) throw new ApiError(400,'invalid_input',`${label}: неизвестные поля или требуется объект`);
  return value as Record<string,unknown>;
}

export function packagingField(value:unknown, unit:string): Packaging|null {
  if (value===undefined || value===null) return null;
  const body=closedObject(value,['kind','tileAreaM2','tilesPerPack','packSizeL','packSizeKg'],'packaging');
  const kind=body.kind;
  if (typeof kind!=='string' || !Object.hasOwn(fields,kind)) throw new ApiError(400,'invalid_input','packaging.kind: неизвестная фасовка');
  const k=kind as Packaging['kind'];
  closedObject(body,['kind',...fields[k]],'packaging');
  if (unit!==units[k]) throw new ApiError(400,'invalid_input',`Для фасовки ${kind} единица продажи должна быть «${units[k]}»`);
  for (const field of fields[k]) {
    const n=body[field];
    if (typeof n!=='number' || !Number.isFinite(n) || n<=0 || n>1e9 || (field==='tilesPerPack' && !Number.isInteger(n))) throw new ApiError(400,'invalid_input',`packaging.${field}: требуется положительное ${field==='tilesPerPack'?'целое ':''}число не больше 1000000000`);
  }
  return {...body} as Packaging;
}

export function normalizeMaterialRequest(value:unknown, withDate=false) {
  const body=closedObject(value,withDate?['productId','kind','inputs','stageDate']:['productId','kind','inputs'],'Расчёт');
  if (typeof body.kind!=='string' || !Object.hasOwn(inputFields,body.kind)) throw new ApiError(400,'invalid_input','kind: неизвестный калькулятор');
  const kind=body.kind as Packaging['kind'];
  const raw=closedObject(body.inputs,inputFields[kind],'inputs');
  const inputs:Record<string,number>={};
  for (const field of inputFields[kind]) {
    const n=raw[field]===undefined ? (field==='wastePercent'?10:field==='coats'?2:undefined) : raw[field];
    if (typeof n!=='number' || !Number.isFinite(n) || n>1e9 || (field==='wastePercent'?n<0:n<=0) || (field==='coats' && !Number.isInteger(n))) throw new ApiError(400,'invalid_input',`inputs.${field}: некорректное число`);
    inputs[field]=Object.is(n,-0)?0:n;
  }
  return {productId:uuidField(body.productId,'productId').toLowerCase(),kind,inputs,...(withDate?{stageDate:dateField(body.stageDate,'stageDate')}:{})};
}

export function calculateMaterial(product:MaterialProduct, request:ReturnType<typeof normalizeMaterialRequest>) {
  const packaging=packagingField(product.packaging,product.unit);
  if (!packaging) throw new ApiError(400,'packaging_unavailable','У товара не задана структурированная фасовка; используйте ручной ввод');
  if (packaging.kind!==request.kind) throw new ApiError(400,'packaging_mismatch','Фасовка товара не подходит выбранному калькулятору');
  const body={...request.inputs,...packaging};
  const result=request.kind==='tiles'?calculateTiles(body):request.kind==='paint'?calculatePaint(body):calculateDryMix(body);
  const packCoverage=packaging.kind==='tiles'?packaging.tileAreaM2*packaging.tilesPerPack:packaging.kind==='paint'?packaging.packSizeL:packaging.packSizeKg;
  const coverage=result.packages*packCoverage;
  if (!Number.isFinite(coverage) || coverage<=0) throw new ApiError(400,'invalid_input','Некорректное покрытие упаковок');
  return {productId:product.id,unit:product.unit,packaging,...result,coverage,coverageUnit:packaging.kind==='tiles'?'м²':packaging.kind==='paint'?'л':'кг'};
}
