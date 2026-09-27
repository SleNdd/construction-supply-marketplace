import type { Product } from '@/lib/api';

export function MaterialArt({ product, large = false }: { product: Product; large?: boolean }) {
  const text = `${product.name} ${typeof product.category === 'string' ? product.category : product.category.name}`.toLowerCase();
  const kind = /кирпич|блок|газобетон/.test(text) ? 'brick' : /плитк|керамогранит/.test(text) ? 'tile' : /краск|грунт|лак/.test(text) ? 'paint' : /утепл|минват|изоляц/.test(text) ? 'insulation' : /труб|кабел|электр/.test(text) ? 'pipe' : /цемент|смес|штукатур|клей|шпаклев/.test(text) ? 'mix' : 'general';
  return <div className={`material-art material-${kind}${large ? ' large' : ''}`} aria-label={`Иллюстрация: ${product.name}`} role="img"><span className="art-grid"/><span className="art-object a"/><span className="art-object b"/><span className="art-object c"/><span className="art-label">ОМ / {kind.toUpperCase()}</span></div>;
}
