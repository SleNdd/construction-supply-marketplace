import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDryMix, calculatePaint, calculateTiles } from '../src/calculators';
import { ApiError } from '../src/security';

const cases = [
  { calculate: calculateTiles, body: { areaM2: 10, tileAreaM2: 0.25, tilesPerPack: 12, wastePercent: 10 }, consumption: 44, packages: 4 },
  { calculate: calculatePaint, body: { areaM2: 35, rateLPerM2: 0.1, coats: 2, packSizeL: 5, wastePercent: 10 }, consumption: 7.7, packages: 2 },
  { calculate: calculateDryMix, body: { areaM2: 12, layerMm: 5, rateKgPerM2Mm: 0.8, packSizeKg: 25, wastePercent: 10 }, consumption: 52.8, packages: 3 },
];

function invalidInput(action: () => unknown) {
  assert.throws(action, (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === 'invalid_input');
}

test('обычные расчёты сохраняют расход и округление упаковок вверх', () => {
  for (const { calculate, body, consumption, packages } of cases) {
    const result = calculate(body);
    assert.equal(result.calculatedConsumption, consumption);
    assert.equal(result.packages, packages);
    assert.ok(Number.isFinite(result.calculatedConsumption));
    assert.ok(Number.isSafeInteger(result.packages));
    assert.equal(JSON.parse(JSON.stringify(result)).packages, packages);
  }
});

test('нулевой запас и граница целой упаковки не требуют epsilon', () => {
  const geometries = [
    { calculate: calculateTiles, body: { tileAreaM2: 1, tilesPerPack: 1, wastePercent: 0 } },
    { calculate: calculatePaint, body: { rateLPerM2: 1, coats: 1, packSizeL: 1, wastePercent: 0 } },
    { calculate: calculateDryMix, body: { layerMm: 1, rateKgPerM2Mm: 1, packSizeKg: 1, wastePercent: 0 } },
  ];
  for (const { calculate, body } of geometries) {
    assert.equal(calculate({ ...body, areaM2: 1 - Number.EPSILON }).packages, 1);
    assert.equal(calculate({ ...body, areaM2: 1 }).packages, 1);
    // Даже минимальное превышение требует следующей упаковки.
    assert.equal(calculate({ ...body, areaM2: 1 + Number.EPSILON }).packages, 2);
  }
  assert.equal(calculatePaint({ areaM2: 35, rateLPerM2: 0.1, coats: 2, packSizeL: 1, wastePercent: 0 }).calculatedConsumption, 7);
});

test('каждый числовой вход отклоняет отрицательные, нечисловые и бесконечные значения', () => {
  for (const { calculate, body } of cases) {
    for (const name of Object.keys(body)) {
      for (const value of [-1, '1', NaN, Infinity, -Infinity, 1e9 + 1]) {
        invalidInput(() => calculate({ ...body, [name]: value }));
      }
      if (name !== 'wastePercent') invalidInput(() => calculate({ ...body, [name]: 0 }));
    }
  }
  invalidInput(() => calculatePaint({ ...cases[1].body, coats: 1.5 }));
  invalidInput(() => calculateTiles({ ...cases[0].body, tilesPerPack: 1.5 }));
});

test('слишком малая упаковка даёт 400 вместо Infinity и JSON null', () => {
  invalidInput(() => calculatePaint({ ...cases[1].body, packSizeL: 1e-308 }));
  invalidInput(() => calculateDryMix({ ...cases[2].body, packSizeKg: 1e-308 }));
  invalidInput(() => calculateTiles({ ...cases[0].body, tileAreaM2: 1e-308 }));
});

test('поддерживается не более миллиона упаковок для одной потребности', () => {
  const geometries = [
    { calculate: calculateTiles, body: { tileAreaM2: 1, tilesPerPack: 1, wastePercent: 0 } },
    { calculate: calculatePaint, body: { rateLPerM2: 1, coats: 1, packSizeL: 1, wastePercent: 0 } },
    { calculate: calculateDryMix, body: { layerMm: 1, rateKgPerM2Mm: 1, packSizeKg: 1, wastePercent: 0 } },
  ];
  for (const { calculate, body } of geometries) {
    assert.equal(calculate({ ...body, areaM2: 1e6 }).packages, 1e6);
    invalidInput(() => calculate({ ...body, areaM2: 1e6 + 0.001 }));
  }
});

test('предел расхода включителен, превышение и экстремальные произведения дают 400', () => {
  const geometries = [
    { calculate: calculateTiles, body: { tileAreaM2: 1, tilesPerPack: 1000, wastePercent: 0 } },
    { calculate: calculatePaint, body: { rateLPerM2: 1, coats: 1, packSizeL: 1000, wastePercent: 0 } },
    { calculate: calculateDryMix, body: { layerMm: 1, rateKgPerM2Mm: 1, packSizeKg: 1000, wastePercent: 0 } },
  ];
  for (const { calculate, body } of geometries) {
    assert.equal(calculate({ ...body, areaM2: 1e9 }).calculatedConsumption, 1e9);
    invalidInput(() => calculate({ ...body, areaM2: 1e9, wastePercent: 1 }));
    invalidInput(() => calculate({ ...body, areaM2: 1e9, wastePercent: 1e9 }));
  }
  // Размер плитки или упаковки не отменяет предел площади и количества плиток.
  invalidInput(() => calculateTiles({ areaM2: 1e9, tileAreaM2: 1e9, tilesPerPack: 1, wastePercent: 10 }));
  invalidInput(() => calculateTiles({ areaM2: 1, tileAreaM2: 1e-10, tilesPerPack: 1e9, wastePercent: 0 }));
});

test('исчезнувший при умножении расход и нулевое число упаковок дают 400', () => {
  invalidInput(() => calculatePaint({ areaM2: Number.MIN_VALUE, rateLPerM2: Number.MIN_VALUE, coats: 1, packSizeL: 1, wastePercent: 0 }));
  invalidInput(() => calculateDryMix({ areaM2: Number.MIN_VALUE, layerMm: Number.MIN_VALUE, rateKgPerM2Mm: 1, packSizeKg: 1, wastePercent: 0 }));
  invalidInput(() => calculatePaint({ areaM2: Number.MIN_VALUE, rateLPerM2: 1, coats: 1, packSizeL: 1e9, wastePercent: 0 }));
});

test('малый положительный расход не отображается как нулевой', () => {
  for (const result of [
    calculatePaint({ areaM2: 0.001, rateLPerM2: 0.1, coats: 1, packSizeL: 1, wastePercent: 0 }),
    calculateDryMix({ areaM2: 0.001, layerMm: 0.1, rateKgPerM2Mm: 1, packSizeKg: 1, wastePercent: 0 }),
  ]) {
    assert.equal(result.calculatedConsumption, 0.0001);
    assert.equal(result.packages, 1);
  }
});
