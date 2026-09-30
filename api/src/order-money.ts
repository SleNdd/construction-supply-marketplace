import { ApiError } from './security';

type OrderMoney = { itemsTotalKopecks: number; deliveryTotalKopecks: number; totalKopecks: number };

function amount(value: unknown, field: keyof OrderMoney): number {
  const decimal = typeof value === 'string' && value.length > 0 && !/\D/.test(value);
  const parsed = typeof value === 'number' ? value : decimal ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(500, 'invalid_order_amount', `Некорректная сохранённая сумма заказа: ${field}`);
  }
  return parsed;
}

// pg сохраняет bigint строкой; преобразование ограничено итогами одного заказа.
export function normalizeOrderMoney<T extends Record<string, unknown>>(order: T): Omit<T, keyof OrderMoney> & OrderMoney {
  return {
    ...order,
    itemsTotalKopecks: amount(order.itemsTotalKopecks, 'itemsTotalKopecks'),
    deliveryTotalKopecks: amount(order.deliveryTotalKopecks, 'deliveryTotalKopecks'),
    totalKopecks: amount(order.totalKopecks, 'totalKopecks'),
  };
}
