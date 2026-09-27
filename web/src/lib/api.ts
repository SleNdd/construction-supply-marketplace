export type User = { id: string; name: string; email: string; role: 'buyer' | 'supplier' | 'dispatcher' | 'driver' | 'admin' };
export type Category = { id: string; name: string; slug: string };
export type Offer = { id: string; supplierId: string; supplierName: string; warehouseId: string; priceKopecks: number; stock: number; deliveryDays: number; deliveryCostKopecks: number };
export type Product = { id: string; slug: string; name: string; category: string | Category; unit: string; imageUrl?: string; priceFromKopecks: number; description?: string; specs?: Record<string, string | number>; offers?: Offer[] };
export type CartItem = { offerId: string; quantity: number; productId: string; productName: string; supplierName: string; priceKopecks: number; unit: string };
export type Project = { id: string; name: string; address: string; stages?: unknown[]; items?: Array<{ id?: string; productId: string; productName?: string; unit?: string; quantity: number; product?: Product; stageDate?: string }> };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (!res.ok) {
    let message = `Ошибка запроса (${res.status})`;
    try { const data = await res.json(); message = data.message || message; } catch { /* Server can return an empty error response. */ }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export const money = (kopecks: number | undefined) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: (kopecks || 0) % 100 ? 2 : 0, maximumFractionDigits: (kopecks || 0) % 100 ? 2 : 0 }).format((kopecks || 0) / 100);
export const categoryName = (value: string | Category) => typeof value === 'string' ? value : value.name;
export function quantityUnit(quantity: number, unit: string): string {
  const forms: Record<string, [string, string, string]> = {
    мешок: ['мешок', 'мешка', 'мешков'],
    ведро: ['ведро', 'ведра', 'вёдер'],
    упаковка: ['упаковка', 'упаковки', 'упаковок'],
    лист: ['лист', 'листа', 'листов'],
    рулон: ['рулон', 'рулона', 'рулонов'],
    позиция: ['позиция', 'позиции', 'позиций'],
  };
  const words = forms[unit];
  if (!words) return `${quantity} ${unit}`;
  const tens = quantity % 100;
  const ones = quantity % 10;
  const form = tens >= 11 && tens <= 14 ? words[2] : ones === 1 ? words[0] : ones >= 2 && ones <= 4 ? words[1] : words[2];
  return `${quantity} ${form}`;
}
