import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOrderMoney } from '../src/order-money';
import { ApiError } from '../src/security';

const fields = ['itemsTotalKopecks', 'deliveryTotalKopecks', 'totalKopecks'] as const;
const stored = { itemsTotalKopecks: '326200', deliveryTotalKopecks: '10000', totalKopecks: '336200' };

test('order totals become exact JSON numbers without changing the stored row', () => {
  const row = { ...stored, id: 'order', status: 'paid', items: [{ priceKopecks: 100 }] };
  const result = normalizeOrderMoney(row);
  assert.deepEqual(result, { ...row, itemsTotalKopecks: 326200, deliveryTotalKopecks: 10000, totalKopecks: 336200 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(row, { ...stored, id: 'order', status: 'paid', items: [{ priceKopecks: 100 }] });
  assert.notEqual(result, row);
});

test('each order amount accepts zero, values above int32 and MAX_SAFE_INTEGER as strings or numbers', () => {
  for (const field of fields) {
    for (const expected of [0, 2147483648, Number.MAX_SAFE_INTEGER]) {
      for (const value of [expected, String(expected)]) {
        assert.equal(normalizeOrderMoney({ ...stored, [field]: value })[field], expected, `${field}: ${value}`);
      }
    }
  }
});

test('each invalid stored amount fails with 500 instead of coercion or rounding', () => {
  const invalid = [
    Number.MAX_SAFE_INTEGER + 1, '9007199254740992', '9007199254740993',
    NaN, Infinity, -Infinity, 1.5, '1.5', '1.00000000000000001',
    -1, '-1', '', ' ', ' 1', '1 ', '1\n', '+1', '1e2', '0x10', 'garbage', 'NaN',
    null, undefined, true, {}, [], 1n,
  ];
  for (const field of fields) {
    for (const value of invalid) {
      assert.throws(() => normalizeOrderMoney({ ...stored, [field]: value }), (error: unknown) => {
        assert.ok(error instanceof ApiError, `${field}: ${String(value)}`);
        assert.equal(error.status, 500);
        assert.equal(error.code, 'invalid_order_amount');
        assert.ok(error.message.includes(field));
        return true;
      });
    }
    const missing: Record<string, unknown> = { ...stored };
    delete missing[field];
    assert.throws(() => normalizeOrderMoney(missing), (error: unknown) => error instanceof ApiError && error.status === 500 && error.code === 'invalid_order_amount');
  }
});
