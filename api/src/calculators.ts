import { ApiError } from './security';

function number(value: unknown, name: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new ApiError(400, 'invalid_input', `${name}: требуется ${allowZero ? 'неотрицательное' : 'положительное'} число`);
  return value;
}

function packages(consumption: number, packSize: number) {
  if (!Number.isFinite(consumption) || consumption > 1e9) throw new ApiError(400, 'invalid_input', 'Слишком большой объём');
  return Math.ceil(consumption / packSize);
}

export function calculateTiles(body: Record<string, unknown>) {
  const areaM2 = number(body.areaM2, 'areaM2');
  const tileAreaM2 = number(body.tileAreaM2, 'tileAreaM2');
  const tilesPerPack = number(body.tilesPerPack, 'tilesPerPack');
  if (!Number.isInteger(tilesPerPack)) throw new ApiError(400, 'invalid_input', 'tilesPerPack: требуется целое число');
  const wastePercent = number(body.wastePercent ?? 10, 'wastePercent', true);
  const consumption = areaM2 * (1 + wastePercent / 100);
  const units = Math.ceil(consumption / tileAreaM2);
  return { formula: 'ceil(площадь × (1 + запас / 100) / площадь плитки)', calculatedConsumption: units, consumptionUnit: 'шт.', packages: packages(units, tilesPerPack), packSize: tilesPerPack };
}

export function calculatePaint(body: Record<string, unknown>) {
  const areaM2 = number(body.areaM2, 'areaM2');
  const rateLPerM2 = number(body.rateLPerM2, 'rateLPerM2');
  const coats = number(body.coats ?? 2, 'coats');
  const packSizeL = number(body.packSizeL, 'packSizeL');
  const wastePercent = number(body.wastePercent ?? 10, 'wastePercent', true);
  if (!Number.isInteger(coats)) throw new ApiError(400, 'invalid_input', 'coats: требуется целое число');
  const consumption = areaM2 * rateLPerM2 * coats * (1 + wastePercent / 100);
  return { formula: 'площадь × расход на м² × слои × (1 + запас / 100)', calculatedConsumption: Math.round(consumption * 1000) / 1000, consumptionUnit: 'л', packages: packages(consumption, packSizeL), packSize: packSizeL };
}

export function calculateDryMix(body: Record<string, unknown>) {
  const areaM2 = number(body.areaM2, 'areaM2');
  const layerMm = number(body.layerMm, 'layerMm');
  const rateKgPerM2Mm = number(body.rateKgPerM2Mm, 'rateKgPerM2Mm');
  const packSizeKg = number(body.packSizeKg, 'packSizeKg');
  const wastePercent = number(body.wastePercent ?? 10, 'wastePercent', true);
  const consumption = areaM2 * layerMm * rateKgPerM2Mm * (1 + wastePercent / 100);
  return { formula: 'площадь × толщина слоя × расход на м²·мм × (1 + запас / 100)', calculatedConsumption: Math.round(consumption * 1000) / 1000, consumptionUnit: 'кг', packages: packages(consumption, packSizeKg), packSize: packSizeKg };
}
