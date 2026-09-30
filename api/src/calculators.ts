import { ApiError } from './security';

// Пределы одного расчёта защищают от переполнения и непрактичных объёмов.
export const CALCULATOR_LIMITS = { maxInput: 1e9, maxConsumption: 1e9, maxPackages: 1e6 } as const;

function number(value: unknown, name: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new ApiError(400, 'invalid_input', `${name}: требуется ${allowZero ? 'неотрицательное' : 'положительное'} число`);
  if (value > CALCULATOR_LIMITS.maxInput) throw new ApiError(400, 'invalid_input', `${name}: значение не должно превышать ${CALCULATOR_LIMITS.maxInput}`);
  return value;
}

function checkConsumption(consumption: number): number {
  if (!Number.isFinite(consumption) || consumption <= 0 || consumption > CALCULATOR_LIMITS.maxConsumption) throw new ApiError(400, 'invalid_input', `Расход должен быть больше нуля и не превышать ${CALCULATOR_LIMITS.maxConsumption}`);
  return consumption;
}

function packages(consumption: number, packSize: number) {
  checkConsumption(consumption);
  const count = Math.ceil(consumption / packSize);
  if (!Number.isSafeInteger(count) || count < 1 || count > CALCULATOR_LIMITS.maxPackages) throw new ApiError(400, 'invalid_input', `Количество упаковок должно быть от 1 до ${CALCULATOR_LIMITS.maxPackages}; проверьте расход и размер упаковки`);
  return count;
}

function displayConsumption(consumption: number) {
  const rounded = Math.round(consumption * 1000) / 1000;
  return rounded || consumption;
}

export function calculateTiles(body: Record<string, unknown>) {
  const areaM2 = number(body.areaM2, 'areaM2');
  const tileAreaM2 = number(body.tileAreaM2, 'tileAreaM2');
  const tilesPerPack = number(body.tilesPerPack, 'tilesPerPack');
  if (!Number.isInteger(tilesPerPack)) throw new ApiError(400, 'invalid_input', 'tilesPerPack: требуется целое число');
  const wastePercent = number(body.wastePercent ?? 10, 'wastePercent', true);
  const consumption = checkConsumption(areaM2 * (1 + wastePercent / 100));
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
  return { formula: 'площадь × расход на м² × слои × (1 + запас / 100)', calculatedConsumption: displayConsumption(consumption), consumptionUnit: 'л', packages: packages(consumption, packSizeL), packSize: packSizeL };
}

export function calculateDryMix(body: Record<string, unknown>) {
  const areaM2 = number(body.areaM2, 'areaM2');
  const layerMm = number(body.layerMm, 'layerMm');
  const rateKgPerM2Mm = number(body.rateKgPerM2Mm, 'rateKgPerM2Mm');
  const packSizeKg = number(body.packSizeKg, 'packSizeKg');
  const wastePercent = number(body.wastePercent ?? 10, 'wastePercent', true);
  const consumption = areaM2 * layerMm * rateKgPerM2Mm * (1 + wastePercent / 100);
  return { formula: 'площадь × толщина слоя × расход на м²·мм × (1 + запас / 100)', calculatedConsumption: displayConsumption(consumption), consumptionUnit: 'кг', packages: packages(consumption, packSizeKg), packSize: packSizeKg };
}
