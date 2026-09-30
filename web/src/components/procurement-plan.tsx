'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, ShoppingBag, Truck } from 'lucide-react';
import { api, type CartItem, type Offer, type Product, type Project, money, quantityUnit } from '@/lib/api';
import { formatCalendarDate } from '@/lib/calendar-date';
import { readCart } from '@/lib/storage';

type Need = NonNullable<Project['items']>[number];
type Quote = {
  lines: Array<{ offerId: string; earliestDeliveryDate: string }>;
  itemsTotalKopecks: number;
  deliveryTotalKopecks: number;
  totalKopecks: number;
  unavailable: Array<{ offerId: string; reason: string }>;
  warnings: string[];
  pricingNote: string;
  zoneAvailable: boolean;
};
type CatalogState = { key: string; products: Record<string, Product>; selected: Record<string, string> };
type Failure = { key: string; message: string };

function needKey(item: Need, index: number) {
  return item.id || `${item.productId}-${index}`;
}

function meetsStage(offer: Offer, stageDate?: string | null) {
  return !stageDate || Boolean(offer.earliestDeliveryDate && offer.earliestDeliveryDate <= stageDate);
}

export function ProcurementPlan({ project, addToCart }: { project: Project; addToCart: (item: CartItem) => void }) {
  const needs = useMemo(() => project.items || [], [project.items]);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [catalogFailure, setCatalogFailure] = useState<Failure | null>(null);
  const [quoteResult, setQuoteResult] = useState<{ key: string; value: Quote } | null>(null);
  const [quoteFailure, setQuoteFailure] = useState<Failure | null>(null);
  const requestKey = JSON.stringify([project.id, needs, attempt]);
  const currentCatalog = catalog?.key === requestKey ? catalog : null;
  const catalogError = catalogFailure?.key === requestKey ? catalogFailure.message : '';
  const loading = needs.length > 0 && !currentCatalog && !catalogError;

  useEffect(() => {
    setCatalog(null);
    if (!needs.length) return;
    const controller = new AbortController();
    Promise.all([...new Set(needs.map(item => item.productId))].map(id => api<Product>(`/products/${id}`, { signal: controller.signal })))
      .then(rows => {
        if (controller.signal.aborted) return;
        const products = Object.fromEntries(rows.map(row => [row.id, row]));
        const selected: Record<string, string> = {};
        needs.forEach((need, index) => {
          const offers = (products[need.productId]?.offers || []).filter(offer => offer.stock >= need.quantity && meetsStage(offer, need.stageDate));
          offers.sort((a, b) => (a.priceKopecks * need.quantity + a.deliveryCostKopecks) - (b.priceKopecks * need.quantity + b.deliveryCostKopecks) || a.id.localeCompare(b.id));
          if (offers[0]) selected[needKey(need, index)] = offers[0].id;
        });
        setCatalog({ key: requestKey, products, selected });
        setCatalogFailure(null);
      })
      .catch(issue => {
        if (!controller.signal.aborted) setCatalogFailure({ key: requestKey, message: (issue as Error).message });
      });
    return () => controller.abort();
  }, [requestKey, needs]);

  const chosen = useMemo(() => needs.flatMap((need, index) => {
    const offer = currentCatalog?.products[need.productId]?.offers?.find(row => row.id === currentCatalog.selected[needKey(need, index)]);
    return offer ? [{ need, offer }] : [];
  }), [needs, currentCatalog]);
  const quoteItems = useMemo(() => chosen.map(({ need, offer }) => ({ offerId: offer.id, quantity: need.quantity })), [chosen]);
  const quoteKey = currentCatalog && chosen.length === needs.length && needs.length > 0
    ? JSON.stringify([requestKey, quoteItems, project.address]) : '';
  // Ключ связывает сумму с текущими позициями: старый ответ нельзя добавить в корзину.
  const quote = quoteResult?.key === quoteKey ? quoteResult.value : null;
  const quoteError = quoteFailure?.key === quoteKey ? quoteFailure.message : '';
  const calculating = Boolean(quoteKey && !quote && !quoteError);

  useEffect(() => {
    setQuoteResult(null);
    setQuoteFailure(null);
    if (!quoteKey) return;
    const controller = new AbortController();
    api<Quote>('/quotes', { method: 'POST', body: JSON.stringify({ items: quoteItems, address: project.address }), signal: controller.signal })
      .then(value => {
        if (!controller.signal.aborted) {
          setQuoteResult({ key: quoteKey, value });
          setQuoteFailure(null);
        }
      })
      .catch(issue => {
        if (!controller.signal.aborted) setQuoteFailure({ key: quoteKey, message: (issue as Error).message });
      });
    return () => controller.abort();
  }, [quoteKey, quoteItems, project.address]);

  const stageConflicts = quote ? chosen.filter(({ need, offer }) => {
    if (!need.stageDate) return false;
    const line = quote.lines.find(row => row.offerId === offer.id);
    return !line?.earliestDeliveryDate || line.earliestDeliveryDate > need.stageDate;
  }) : [];
  const canAdd = Boolean(quote && !calculating && !loading && chosen.length === needs.length && !quote.unavailable.length && quote.zoneAvailable && !stageConflicts.length);

  const [addFailure, setAddFailure] = useState<Failure | null>(null);
  const addError = addFailure?.key === quoteKey ? addFailure.message : "";

  function addPlan() {
    if (!canAdd || !currentCatalog) return;
    setAddFailure(null);
    const cart = readCart();
    const quantities = new Map(cart.map(item => [item.offerId, item.quantity]));
    for (const { need, offer } of chosen) quantities.set(offer.id, (quantities.get(offer.id) || 0) + need.quantity);
    if (quantities.size > 50 || [...quantities.values()].some(quantity => quantity > 10000)) {
      setAddFailure({ key: quoteKey, message: 'План не добавлен: в корзине допускается до 50 предложений и до 10 000 единиц каждого. Уменьшите количество или освободите корзину.' });
      return;
    }
    for (const { need, offer } of chosen) {
      const product = currentCatalog.products[need.productId];
      addToCart({ offerId: offer.id, quantity: need.quantity, productId: need.productId, productName: product.name, supplierName: offer.supplierName, priceKopecks: offer.priceKopecks, unit: product.unit });
    }
    const items = readCart().map(({ offerId, quantity }) => ({ offerId, quantity })).sort((a, b) => a.offerId.localeCompare(b.offerId));
    sessionStorage.setItem('objectmarket-project-checkout', JSON.stringify({ projectId: project.id, address: project.address, items }));
  }

  return <section className="workspace-panel procurement-plan" aria-labelledby="procurement-heading">
    <div className="panel-heading"><div><span className="overline">ПЛАН ЗАКУПКИ</span><h2 id="procurement-heading">Предложения для объекта</h2></div><Truck size={23} /></div>
    <p className="muted">Сначала выбираем предложение по цене позиции с доставкой. Ближайшие даты рассчитаны сервером по календарю Астрахани. Итог пересчитывается по поставщикам; наличие и срок проверяются повторно при оформлении.</p>
    {loading ? <div className="loading-row" role="status">Подбираем предложения…</div> : currentCatalog && needs.length > 0 ? <div className="plan-offers">{needs.map((need, index) => {
      const product = currentCatalog.products[need.productId];
      const offers = product?.offers || [];
      const available = offers.filter(offer => offer.stock >= need.quantity && meetsStage(offer, need.stageDate));
      const key = needKey(need, index);
      const offer = available.find(value => value.id === currentCatalog.selected[key]);
      return <div className="plan-offer-row" key={key}>
        <div><b>{need.productName || product?.name || need.productId}</b><small>{quantityUnit(need.quantity, product?.unit || need.unit || 'ед.')}{need.stageDate ? ` · к ${formatCalendarDate(need.stageDate)}` : ''}</small></div>
        {available.length > 0 ? <>
          <label>Поставщик и предложение<select value={currentCatalog.selected[key] || ''} onChange={event => {
            setQuoteResult(null);
            setQuoteFailure(null);
            setCatalog(current => current?.key === requestKey ? { ...current, selected: { ...current.selected, [key]: event.target.value } } : current);
          }}>
            {available.map(value => <option value={value.id} key={value.id}>{value.supplierName} · {money(value.priceKopecks)} / {product.unit} · {value.deliveryDays} дн.</option>)}
          </select></label>
          <div className="plan-offer-cost"><span>Материалы {money((offer?.priceKopecks || 0) * need.quantity)}</span><span>Доставка {money(offer?.deliveryCostKopecks)}</span>{offer?.earliestDeliveryDate && <span>Не раньше {formatCalendarDate(offer.earliestDeliveryDate)}</span>}</div>
        </> : <div className="plan-unavailable">{offers.length === 0 ? 'Нет активных предложений.' : offers.every(value => value.stock < need.quantity) ? `Ни на одном складе нет ${quantityUnit(need.quantity, product.unit)}.` : 'Предложения с нужным остатком не успевают к дате этапа.'} <Link href={`/product/${need.productId}`}>Смотреть товар</Link></div>}
      </div>;
    })}</div> : !needs.length ? <p className="muted">Добавьте материалы в перечень, чтобы рассчитать закупку.</p> : null}
    {(catalogError || quoteError) && <p className="form-error" role="alert">{catalogError || quoteError}</p>}
    {calculating && <p className="muted" role="status">Проверяем остатки, сроки и стоимость доставки…</p>}
    {quote && <div className="plan-quote"><div><span>Материалы</span><b>{money(quote.itemsTotalKopecks)}</b></div><div><span>Доставка</span><b>{money(quote.deliveryTotalKopecks)}</b></div><div className="plan-quote-total"><span>Итого</span><b>{money(quote.totalKopecks)}</b></div><small>{quote.pricingNote}</small>
      {quote.warnings.map((warning, index) => <p className="form-warning" key={index}>{warning}</p>)}
      {quote.unavailable.map(item => <p className="form-error" role="alert" key={item.offerId}>{chosen.find(value => value.offer.id === item.offerId)?.need.productName}: {item.reason}</p>)}
      {stageConflicts.map(({ need, offer }) => <p className="form-error" role="alert" key={need.id || `${need.productId}-${need.stageDate}`}>{need.productName}: срок предложения изменился и не подходит к этапу {formatCalendarDate(need.stageDate!)}. Обновите предложения.</p>)}
    </div>}
    {addError && <p className="form-error" role="alert">{addError}</p>}
    {needs.length > 0 && <div className="plan-actions"><button className="btn btn-dark" disabled={!canAdd} onClick={addPlan}><ShoppingBag size={16} /> Добавить план в корзину</button><Link href="/cart" className="text-link">Открыть корзину <ArrowRight size={16} /></Link><button className="link-button" onClick={() => setAttempt(value => value + 1)} disabled={loading}><RefreshCw size={14} /> Обновить предложения</button></div>}
  </section>;
}
