import { ApiError } from './security';

export type Coordinates = [number, number];
export type DeparturePoint = { warehouseId: string; name: string; address: string; coordinates: Coordinates | null };
export type WarehousePointRow = { warehouse_id: string; warehouse_name: string; warehouse_address: string; warehouse_lon: unknown; warehouse_lat: unknown };

function validCoordinates(value: unknown): value is Coordinates {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

export function parseDestinationCoordinates(value: unknown): Coordinates | null {
  if (value == null) return null;
  if (!validCoordinates(value)) throw new ApiError(400, 'invalid_input', 'destinationCoordinates: ожидаются [долгота, широта] в допустимых пределах');
  return [value[0], value[1]];
}

// PostgreSQL numeric возвращается строкой; отсутствие или ошибочный геокод не создаёт точку (0, 0).
function warehouseCoordinate(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return NaN;
}

export function snapshotDeparturePoints(rows: WarehousePointRow[]): DeparturePoint[] {
  const points = new Map<string, DeparturePoint>();
  for (const row of rows) {
    const coordinates = [warehouseCoordinate(row.warehouse_lon), warehouseCoordinate(row.warehouse_lat)];
    points.set(row.warehouse_id, { warehouseId: row.warehouse_id, name: row.warehouse_name, address: row.warehouse_address,
      coordinates: validCoordinates(coordinates) ? coordinates : null });
  }
  return [...points.values()].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId));
}
