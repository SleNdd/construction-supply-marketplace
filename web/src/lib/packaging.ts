import { quantityUnit, type Product, type ProductPackaging } from './api';

export const formatMeasure = (value: number) => new Intl.NumberFormat('ru-RU', value > 0 && value < .000001 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 6 }).format(value);

export function packagingLabel(packaging: ProductPackaging): string {
  if (packaging.kind === 'tiles') return `${quantityUnit(packaging.tilesPerPack, 'плитка')} × ${formatMeasure(packaging.tileAreaM2)} м² = ${formatMeasure(packaging.tileAreaM2 * packaging.tilesPerPack)} м² / коробка`;
  if (packaging.kind === 'paint') return `${formatMeasure(packaging.packSizeL)} л / ведро`;
  return `${formatMeasure(packaging.packSizeKg)} кг / мешок`;
}

export function supportsCalculation(product: Product, kind: ProductPackaging['kind']): boolean {
  const units = { tiles: 'коробка', paint: 'ведро', 'dry-mix': 'мешок' };
  return product.packaging?.kind === kind && product.unit === units[kind];
}
