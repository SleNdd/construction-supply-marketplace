import type { CartItem } from './api';

const CART_KEY = 'objectmarket-cart';
const COMPARE_KEY = 'objectmarket-compare';

export function readCart(): CartItem[] {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]') as CartItem[]; } catch { return []; }
}
export function saveCart(cart: CartItem[]) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); window.dispatchEvent(new Event('cart-change')); }
export function readCompare(): string[] {
  try { return JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]') as string[]; } catch { return []; }
}
export function saveCompare(ids: string[]) { localStorage.setItem(COMPARE_KEY, JSON.stringify(ids)); window.dispatchEvent(new Event('compare-change')); }
