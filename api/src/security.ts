import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type Role = 'buyer' | 'supplier' | 'dispatcher' | 'driver' | 'admin';
export interface CurrentUser { id: string; name: string; email: string; role: Role }

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex || expectedHex.length !== 128) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected);
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function requireRole(user: CurrentUser | null, ...roles: Role[]): CurrentUser {
  if (!user) throw new ApiError(401, 'unauthorized', 'Необходимо войти в аккаунт');
  if (!roles.includes(user.role)) throw new ApiError(403, 'forbidden', 'Недостаточно прав');
  return user;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export function positiveInt(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new ApiError(400, 'invalid_input', `${name}: требуется положительное целое число`);
  return Number(value);
}

export function nonnegativeInt(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ApiError(400, 'invalid_input', `${name}: требуется неотрицательное целое число`);
  return Number(value);
}

export function textField(value: unknown, name: string, max = 250): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'invalid_input', `${name}: укажите текст длиной до ${max} символов`);
  return value.trim();
}

export function uuidField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, 'invalid_input', `${name}: неверный идентификатор`);
  return value;
}

export function dateField(value: unknown, name: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) throw new ApiError(400, 'invalid_input', `${name}: укажите дату ГГГГ-ММ-ДД`);
  return value;
}
