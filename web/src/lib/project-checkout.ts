import type { CartItem } from './api';

export const PROJECT_CHECKOUT_KEY = 'objectmarket-project-checkout';
type CheckoutItem = Pick<CartItem, 'offerId' | 'quantity'>;
export type ProjectCheckout = { projectId: string; address: string; items: CheckoutItem[]; requestedDate: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function checkoutItems(items: CheckoutItem[]): CheckoutItem[] {
  return items.map(({ offerId, quantity }) => ({ offerId: offerId.toLowerCase(), quantity }))
    .sort((a, b) => a.offerId.localeCompare(b.offerId));
}

// Контекст принадлежит всей корзине. Даже одна добавленная строка снимает привязку.
export function readProjectCheckout(cart: CartItem[]): ProjectCheckout | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(PROJECT_CHECKOUT_KEY) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (typeof source.projectId !== 'string' || !uuid.test(source.projectId) ||
      typeof source.address !== 'string' || !source.address.trim() || source.address.length > 500 ||
      (source.requestedDate !== undefined && source.requestedDate !== null && !isCalendarDate(source.requestedDate)) ||
      !Array.isArray(source.items) || !source.items.length || source.items.length > 50) return null;
    const items: CheckoutItem[] = [];
    const ids = new Set<string>();
    for (const raw of source.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const item = raw as Record<string, unknown>;
      if (typeof item.offerId !== 'string' || !uuid.test(item.offerId) ||
        typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) return null;
      const offerId = item.offerId.toLowerCase();
      if (ids.has(offerId)) return null;
      ids.add(offerId);
      items.push({ offerId, quantity: item.quantity });
    }
    if (JSON.stringify(checkoutItems(items)) !== JSON.stringify(checkoutItems(cart))) return null;
    return { projectId: source.projectId.toLowerCase(), address: source.address, items: checkoutItems(items), requestedDate: source.requestedDate as string | null ?? null };
  } catch { return null; }
}
