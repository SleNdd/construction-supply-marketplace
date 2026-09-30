'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Layers3, MapPin, Package, Search, ShoppingBag, SlidersHorizontal, Truck, X } from 'lucide-react';
import { api, categoryName, type CartItem, type Category, type Offer, type Product, money } from '@/lib/api';
import { CompactProduct, ErrorPanel, PageHeading } from './marketplace';
import { MaterialArt } from './material-art';
import { useDialogFocus } from '@/lib/use-dialog-focus';

type ShoppingProps = { addToCart: (item: CartItem) => void; toggleCompare: (id: string) => void; compare: string[] };

export function Catalog({ categories, addToCart, toggleCompare, compare }: ShoppingProps & { categories: Category[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const appliedQuery = params.get('q') || '';
  const category = params.get('category') || '';
  const sort = params.get('sort') || '';
  const page = Math.min(1000, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  const appliedMin = params.get('price_min') || '';
  const appliedMax = params.get('price_max') || '';
  const inStock = params.get('in_stock') === '1';
  const [query, setQuery] = useState(appliedQuery);
  const [priceMin, setPriceMin] = useState(appliedMin);
  const [priceMax, setPriceMax] = useState(appliedMax);
  const [onlyInStock, setOnlyInStock] = useState(inStock);
  const [filterError, setFilterError] = useState('');
  const [data, setData] = useState<{ items: Product[]; total: number; page: number }>({ items: [], total: 0, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useDialogFocus(filtersOpen, () => setFiltersOpen(false), '[aria-controls="catalog-filters"]');

  useEffect(() => { setQuery(appliedQuery); }, [appliedQuery]);
  useEffect(() => { setPriceMin(appliedMin); setPriceMax(appliedMax); setOnlyInStock(inStock); setFilterError(''); }, [appliedMin, appliedMax, inStock]);
  useEffect(() => {
    const wideScreen = window.matchMedia('(min-width:821px)');
    const closeFilters = () => { if (wideScreen.matches) setFiltersOpen(false); };
    wideScreen.addEventListener('change', closeFilters);
    return () => wideScreen.removeEventListener('change', closeFilters);
  }, []);
  const load = useCallback(() => {
    const current = ++requestId.current;
    setLoading(true); setError('');
    const search = new URLSearchParams({ page: String(page), limit: '12' });
    if (appliedQuery) search.set('q', appliedQuery);
    if (category) search.set('category', category);
    if (sort) search.set('sort', sort);
    if (appliedMin) search.set('minPriceKopecks', String(Number(appliedMin) * 100));
    if (appliedMax) search.set('maxPriceKopecks', String(Number(appliedMax) * 100));
    if (inStock) search.set('inStock', 'true');
    api<{ items: Product[]; total: number; page: number }>(`/products?${search}`)
      .then(result => { if (current === requestId.current) setData(result); })
      .catch(issue => { if (current === requestId.current) setError(issue.message); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
  }, [appliedQuery, category, sort, page, appliedMin, appliedMax, inStock]);
  useEffect(load, [load]);

  const updateUrl = (next: Record<string, string>) => {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value || (key === 'page' && value === '1')) search.delete(key);
      else search.set(key, value);
    }
    router.replace(`/catalog${search.size ? `?${search}` : ''}`, { scroll: false });
  };
  const selectCategory = (value: string) => { updateUrl({ category: value, page: '' }); setFiltersOpen(false); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); updateUrl({ q: query.trim(), page: '' }); };
  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (priceMin && priceMax && Number(priceMax) < Number(priceMin)) { setFilterError('Верхняя граница цены должна быть не меньше нижней.'); return; }
    setFilterError('');
    updateUrl({ price_min: priceMin, price_max: priceMax, in_stock: onlyInStock ? '1' : '', page: '' });
    setFiltersOpen(false);
  };
  const resetFilters = () => {
    setQuery(''); setPriceMin(''); setPriceMax(''); setOnlyInStock(false); setFilterError('');
    router.replace('/catalog', { scroll: false }); searchRef.current?.focus();
  };
  const totalPages = Math.ceil(data.total / 12);
  const filterCount = Number(Boolean(category)) + Number(Boolean(appliedMin || appliedMax)) + Number(inStock);

  return <div className="container page-section catalog-page">
    <PageHeading eyebrow="МАТЕРИАЛЫ / КАТАЛОГ" title="Каталог материалов" description="Подберите материалы для ремонта и строительства — с понятными ценами и условиями поставки." />
    <div className="catalog-toolbar">
      <form className="catalog-search" onSubmit={submit}>
        <Search size={18} />
        <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Название, марка или материал" aria-label="Поиск по каталогу" />
        <button type="submit" aria-label="Искать"><ArrowRight size={18} /></button>
      </form>
      <button className="btn btn-outline filter-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal size={17} /> Фильтры{filterCount > 0 && ` (${filterCount})`}</button>
      <div className="select-wrap">
        <select value={sort} onChange={event => updateUrl({ sort: event.target.value, page: '' })} aria-label="Сортировка">
          <option value="">По умолчанию</option><option value="price_asc">Сначала дешевле</option><option value="price_desc">Сначала дороже</option><option value="name">По названию</option>
        </select><ChevronDown size={16} />
      </div>
    </div>
    <div className="catalog-layout">
      {filtersOpen && <button className="catalog-filter-backdrop" aria-label="Закрыть фильтры" aria-hidden="true" tabIndex={-1} onClick={() => setFiltersOpen(false)} />}
      <aside id="catalog-filters" ref={filterRef} tabIndex={-1} role={filtersOpen ? 'dialog' : undefined} aria-modal={filtersOpen ? true : undefined} aria-label={filtersOpen ? 'Фильтры каталога' : undefined} className={filtersOpen ? 'filter-panel open' : 'filter-panel'}>
        <div className="filter-title"><b>Категории</b><button className="icon-button filter-close" onClick={() => setFiltersOpen(false)} aria-label="Закрыть фильтры"><X size={19} /></button></div>
        <button className={!category ? 'filter-option selected' : 'filter-option'} onClick={() => selectCategory('')}>Все материалы</button>
        {categories.map(item => <button className={category === item.slug ? 'filter-option selected' : 'filter-option'} onClick={() => selectCategory(item.slug)} key={item.id}>{item.name}<ArrowUpRight size={15} /></button>)}
        <form className="catalog-filter-form" onSubmit={applyFilters}>
          <fieldset><legend>Цена, ₽</legend><div className="price-range">
            <label>От<input type="number" min="0" max="21474836" step="1" inputMode="numeric" value={priceMin} onChange={event => setPriceMin(event.target.value)} placeholder="0" /></label>
            <label>До<input type="number" min="0" max="21474836" step="1" inputMode="numeric" value={priceMax} onChange={event => setPriceMax(event.target.value)} placeholder="Любая" /></label>
          </div></fieldset>
          <label className="stock-filter"><input type="checkbox" checked={onlyInStock} onChange={event => setOnlyInStock(event.target.checked)} /> Только в наличии</label>
          <p className="filter-note">Цена «от» — минимальная цена предложения. Доставка рассчитывается отдельно.</p>
          {filterError && <p className="form-error" role="alert">{filterError}</p>}
          <button className="btn btn-outline full" type="submit">Применить</button>
        </form>
        <div className="filter-help"><Package size={22} /><b>Не знаете, сколько нужно?</b><p>Рассчитайте объём для своего объекта.</p><Link href="/projects">К калькуляторам <ArrowRight size={15} /></Link></div>
      </aside>
      <div className="catalog-results">
        <div className="results-caption"><span aria-live="polite">{loading ? 'Загружаем…' : `Найдено товаров: ${data.total}`}</span>{(appliedQuery || filterCount > 0) && <button className="link-button" onClick={resetFilters}>Сбросить фильтры <X size={14} /></button>}</div>
        {error ? <ErrorPanel message={error} onRetry={load} /> : loading ? <div className="loading-row">Загружаем каталог…</div> : data.items.length ? <div className="product-grid catalog-products">{data.items.map(product => <CompactProduct key={product.id} product={product} addToCart={addToCart} toggleCompare={toggleCompare} selected={compare.includes(product.id)} />)}</div> : <div className="empty-state"><Search size={30} /><b>Ничего не найдено</b><p>Попробуйте другое название или категорию.</p></div>}
        {totalPages > 1 && <div className="pagination"><button disabled={page <= 1} onClick={() => updateUrl({ page: String(page - 1) })}>Назад</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => updateUrl({ page: String(page + 1) })}>Далее</button></div>}
      </div>
    </div>
  </div>;
}
export function ProductDetails({ id, addToCart, toggleCompare, compare }: ShoppingProps & {id:string}) {
  const [product,setProduct] = useState<Product|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [quantities,setQuantities]=useState<Record<string,number>>({});
  const load=useCallback(() => {setLoading(true);api<Product>(`/products/${id}`).then(setProduct).catch(issue => setError(issue.message)).finally(() => setLoading(false));},[id]);
  useEffect(load,[load]);
  if (loading) return <div className="container page-section loading-row">Загружаем товар…</div>;
  if (error || !product) return <div className="container page-section"><ErrorPanel message={error || 'Товар не найден'} onRetry={load}/></div>;
  const offers = product.offers || [];
  return <div className="container page-section product-page"><div className="breadcrumbs"><Link href="/catalog">Каталог</Link><span>/</span><span>{categoryName(product.category)}</span><span>/</span><b>{product.name}</b></div><div className="product-detail-grid"><div className="detail-visual"><MaterialArt product={product} large/></div><div className="detail-summary"><span className="overline">{categoryName(product.category)}</span><h1>{product.name}</h1><p>{product.description || 'Материал для строительных и отделочных работ.'}</p><div className="detail-price"><span>Предложения от</span><b>{offers.length?money(Math.min(...offers.map(offer=>offer.priceKopecks))):'Нет предложений'}</b><small>за {product.unit}</small></div><div className="detail-benefits"><span><Check size={16}/> Проверка наличия</span><span><Truck size={16}/> Срок и доставка отдельно</span></div>{offers.length > 0 && <a className="btn btn-dark product-offers-link" href="#product-offers">Доступные предложения <ArrowRight size={16}/></a>}<button className={compare.includes(product.id) ? 'btn btn-outline selected' : 'btn btn-outline'} onClick={() => toggleCompare(product.id)}><Layers3 size={17}/>{compare.includes(product.id) ? 'В сравнении' : 'Добавить к сравнению'}</button><details className="product-id"><summary>ID товара для импорта ведомости</summary><code>{product.id}</code></details></div></div><section className="detail-section" id="product-offers"><div className="section-heading"><div><span className="overline">ПОСТАВЩИКИ</span><h2>Доступные предложения</h2></div><span className="muted">{offers.length} вариантов</span></div>{offers.length ? <div className="offer-list">{offers.map(offer => <div className="offer-row" key={offer.id}><div className="offer-supplier"><span className="supplier-avatar">{offer.supplierName.slice(0,1)}</span><div><b>{offer.supplierName}</b><small><MapPin size={13}/> Склад поставщика</small></div></div><div className="offer-data"><small>На складе</small><b>{offer.stock} {product.unit}</b></div><div className="offer-data"><small>Срок</small><b>{offer.deliveryDays} дн.</b></div><div className="offer-data"><small>Доставка</small><b>{money(offer.deliveryCostKopecks)}</b></div><div className="offer-price"><b>{money(offer.priceKopecks)}</b><small>за {product.unit}</small></div><div className="offer-action"><input type="number" min="1" max={offer.stock} value={quantities[offer.id] || 1} onChange={event => setQuantities({...quantities,[offer.id]:Math.max(1, Math.min(offer.stock || 1, Math.floor(Number(event.target.value) || 1)))})} aria-label="Количество"/><button className="btn btn-dark" disabled={offer.stock < 1 || (quantities[offer.id] || 1) > offer.stock} onClick={() => addToCart({offerId:offer.id,quantity:quantities[offer.id] || 1,productId:product.id,productName:product.name,supplierName:offer.supplierName,priceKopecks:offer.priceKopecks,unit:product.unit})}><ShoppingBag size={16}/> В корзину</button></div><div className="offer-estimate"><span>Материал: {money(offer.priceKopecks * (quantities[offer.id] || 1))} + Доставка: {money(offer.deliveryCostKopecks)}</span><b>{money(offer.priceKopecks * (quantities[offer.id] || 1) + offer.deliveryCostKopecks)}</b><small>Ориентир для одной позиции. При оформлении берётся максимальная ставка доставки на поставщика.</small></div></div>)}</div> : <div className="empty-state">Для этого товара пока нет доступных предложений.</div>}</section>{product.specs && Object.keys(product.specs).length > 0 && <section className="detail-section"><div className="section-heading"><div><span className="overline">ПАРАМЕТРЫ</span><h2>Характеристики</h2></div></div><dl className="spec-list">{Object.entries(product.specs).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></section>}</div>;
}

export function Compare({ ids, addToCart, toggleCompare }: Omit<ShoppingProps,'compare'> & {ids:string[]}) {
  const [products,setProducts]=useState<Product[]>([]);const [loading,setLoading]=useState(true);
  useEffect(() => {setLoading(true);Promise.all(ids.map(id => api<Product>(`/products/${id}`).catch(() => null))).then(values => setProducts(values.filter((value):value is Product => !!value))).finally(() => setLoading(false));},[ids]);
  const keys=useMemo(() => Array.from(new Set(products.flatMap(product => Object.keys(product.specs || {})))),[products]);
  return <div className="container page-section"><PageHeading eyebrow="ВЫБОР / СРАВНЕНИЕ" title="Сравнение материалов" description="Оцените характеристики, цену и доступные предложения рядом."/>{loading ? <div className="loading-row">Собираем сравнение…</div> : products.length ? <div className="compare-scroll"><table className="compare-table"><thead><tr><th>Параметр</th>{products.map(product => <th key={product.id}><button className="compare-remove" onClick={() => toggleCompare(product.id)} title="Убрать"><X size={16}/></button><div className="compare-image"><Package size={31}/></div><Link href={`/product/${product.id}`}>{product.name}</Link></th>)}</tr></thead><tbody><tr><th>Цена от</th>{products.map(product => <td key={product.id} className="compare-price">{product.offers?.length?money(Math.min(...product.offers.map(offer=>offer.priceKopecks))):'—'}</td>)}</tr><tr><th>Категория</th>{products.map(product => <td key={product.id}>{categoryName(product.category)}</td>)}</tr><tr><th>Предложений</th>{products.map(product => <td key={product.id}>{product.offers?.length || 0}</td>)}</tr>{keys.map(key => <tr key={key}><th>{key}</th>{products.map(product => <td key={product.id}>{String(product.specs?.[key] ?? '—')}</td>)}</tr>)}<tr><th></th>{products.map(product => <td key={product.id}><Link href={`/product/${product.id}`} className="btn btn-dark">Выбрать предложение <ArrowRight size={15}/></Link></td>)}</tr></tbody></table></div> : <div className="empty-state large"><Layers3 size={32}/><b>Пока нечего сравнивать</b><p>Добавьте до четырёх материалов из каталога.</p><Link href="/catalog" className="btn btn-dark">Перейти в каталог <ArrowRight size={17}/></Link></div>}</div>;
}
