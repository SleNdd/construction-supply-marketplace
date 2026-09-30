import type { CartItem } from './api';

const CART_KEY = 'objectmarket-cart';
const COMPARE_KEY = 'objectmarket-compare';

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readArray(key: string): unknown[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function readCart(): CartItem[] {
  const cart: CartItem[] = [];
  const offers = new Set<string>();
  for (const value of readArray(CART_KEY)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (!isId(item.offerId) || !isId(item.productId) ||
      !isText(item.productName) || !isText(item.supplierName) || !isText(item.unit) ||
      typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000 ||
      typeof item.priceKopecks !== 'number' || !Number.isInteger(item.priceKopecks) || item.priceKopecks < 1 || item.priceKopecks > 2147483647) continue;
    const offerId = item.offerId.toLowerCase();
    // Первый корректный дубль сохраняется без увеличения закупки.
    if (offers.has(offerId)) continue;
    offers.add(offerId);
    cart.push({ offerId, productId: item.productId.toLowerCase(), quantity: item.quantity,
      productName: item.productName, supplierName: item.supplierName, priceKopecks: item.priceKopecks, unit: item.unit });
  }
  return cart;
}
export function saveCart(cart: CartItem[]) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); window.dispatchEvent(new Event('cart-change')); }
export function readCompare(): string[] {
  return [...new Set(readArray(COMPARE_KEY).filter(isId).map(id => id.toLowerCase()))].slice(0, 4);
}
export function saveCompare(ids: string[]) { localStorage.setItem(COMPARE_KEY, JSON.stringify(ids)); window.dispatchEvent(new Event('compare-change')); }
