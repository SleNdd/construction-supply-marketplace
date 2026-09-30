'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Layers3, RefreshCw, ShoppingBag, X } from 'lucide-react';
import { api, categoryName, money, type CartItem, type Offer, type Product } from '@/lib/api';
import { formatCalendarDate } from '@/lib/calendar-date';
import { PageHeading } from './marketplace';
import { MaterialArt } from './material-art';
import styles from './comparison.module.css';

type Props = { ids: string[]; addToCart: (item: CartItem) => void; toggleCompare: (id: string) => void };
type Quote = {
  lines: Array<{ offerId: string; quantity: number; priceKopecks: number; stock: number; earliestDeliveryDate: string }>;
  itemsTotalKopecks: number; deliveryTotalKopecks: number; totalKopecks: number;
  unavailable: Array<{ offerId: string; reason: string }>;
  warnings: string[]; zoneAvailable: boolean;
};

function unavailableReason(offer: Offer, quantity: number, date: string) {
  if (offer.stock < quantity) return `На складе ${offer.stock}, требуется ${quantity}`;
  if (!offer.earliestDeliveryDate) return 'Ближайшая дата не указана';
  if (date && offer.earliestDeliveryDate > date) return `Поставка не раньше ${formatCalendarDate(offer.earliestDeliveryDate)}`;
  return '';
}

export function Compare({ ids, addToCart, toggleCompare }: Props) {
  const [address, setAddress] = useState('');
  const [date, setDate] = useState('');
  const [revision, setRevision] = useState(0);
  const selected = [...new Set(ids)].slice(0, 4);
  return <div className={`container page-section ${styles.page}`}>
    <PageHeading eyebrow="ВЫБОР / СРАВНЕНИЕ" title="Сравнение материалов" description="Характеристики и стоимость закупки для четырёх материалов рядом."/>
    {selected.length ? <>
      <section className={styles.conditions} aria-label="Условия сравнения">
        <div><span className="overline">ОБЩИЕ УСЛОВИЯ</span><h2>Условия доставки</h2><details><summary>Как считается итог</summary><p>Каждый вариант рассчитывается отдельно: материал и его доставка. Общая корзина пересчитывается при оформлении заказа.</p></details></div>
        <div className={styles.fields}>
          <label>Адрес доставки<input value={address} maxLength={300} onChange={event => { setAddress(event.target.value); setRevision(value => value + 1); }} placeholder="Астрахань, улица, дом" autoComplete="street-address"/></label>
          <label>Желаемая дата<input type="date" value={date} onChange={event => { setDate(event.target.value); setRevision(value => value + 1); }} aria-describedby="comparison-date-hint"/></label>
          <small id="comparison-date-hint">Дата необязательна. Доставка демонстрационная.</small>
        </div>
      </section>
      <p className={styles.explanation}>Предложение выбрано по цене с доставкой. Поставщика можно изменить.</p>
      <div className={styles.grid}>{selected.map((id, index) => <ComparisonCard key={id} id={id} index={index} address={address} date={date} revision={revision} addToCart={addToCart} onRemove={() => toggleCompare(id)}/>)}</div>
    </> : <div className="empty-state large"><Layers3 size={32}/><b>Пока нечего сравнивать</b><p>Добавьте до четырёх материалов из каталога.</p><Link href="/catalog" className="btn btn-dark">Перейти в каталог <ArrowRight size={17}/></Link></div>}
  </div>;
}

function ComparisonCard({ id, index, address, date, revision, addToCart, onRemove }: {
  id: string; index: number; address: string; date: string; revision: number; addToCart: Props['addToCart']; onRemove: () => void;
}) {
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{ key: string; product?: Product; error?: string } | null>(null);
  const [quantityText, setQuantityText] = useState('1');
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; quote?: Quote; error?: string } | null>(null);
  const productKey = `${id}:${reload}`;
  const current = data?.key === productKey ? data : null;
  const product = current?.product;
  const quantity = Number(quantityText);
  const validQuantity = quantityText !== '' && Number.isInteger(quantity) && quantity >= 1 && quantity <= 10000;
  const selectionKey = JSON.stringify([productKey, quantityText, date]);
  const offers = product?.offers || [];
  const eligible = validQuantity ? offers.filter(offer => !unavailableReason(offer, quantity, date)) : [];
  const cheapest = [...eligible].sort((a, b) => (a.priceKopecks * quantity + a.deliveryCostKopecks) - (b.priceKopecks * quantity + b.deliveryCostKopecks) || a.id.localeCompare(b.id))[0];
  const offer = selection?.key === selectionKey ? eligible.find(value => value.id === selection.id) : cheapest;
  const quoteKey = product && offer && validQuantity && address.trim() && address.length <= 300
    ? JSON.stringify([productKey, offer.id, quantity, address, date, revision, attempt]) : '';
  const quote = result?.key === quoteKey ? result.quote : undefined;
  const quoteError = result?.key === quoteKey ? result.error : undefined;
  const line = quote?.lines.find(value => value.offerId === offer?.id && value.quantity === quantity);
  const changedDate = Boolean(quote && date && (!line?.earliestDeliveryDate || line.earliestDeliveryDate > date));
  const canAdd = Boolean(quote && line && line.stock >= quantity && !quote.unavailable.length && quote.zoneAvailable && !changedDate);

  useEffect(() => {
    const controller = new AbortController();
    api<Product>(`/products/${id}`, { signal: controller.signal })
      .then(product => { if (!controller.signal.aborted) setData({ key: productKey, product }); })
      .catch(issue => { if (!controller.signal.aborted) setData({ key: productKey, error: (issue as Error).message }); });
    return () => controller.abort();
  }, [id, productKey]);

  useEffect(() => {
    if (!quoteKey || !offer) return;
    const controller = new AbortController();
    api<Quote>('/quotes', { method: 'POST', signal: controller.signal, body: JSON.stringify({ items: [{ offerId: offer.id, quantity }], address: address.trim(), ...(date ? { requestedDate: date } : {}) }) })
      .then(quote => { if (!controller.signal.aborted) setResult({ key: quoteKey, quote }); })
      .catch(issue => { if (!controller.signal.aborted) setResult({ key: quoteKey, error: (issue as Error).message }); });
    return () => controller.abort();
  }, [quoteKey, offer, quantity, address, date]);

  const add = () => {
    if (!canAdd || !product || !offer || !line) return;
    addToCart({ offerId: offer.id, quantity, productId: product.id, productName: product.name, supplierName: offer.supplierName, priceKopecks: line.priceKopecks, unit: product.unit });
    // После переноса нужна новая проверка: остаток мог измениться, а корзина уже содержит эту позицию.
    setAttempt(value => value + 1);
  };

  return <article className={styles.card} aria-label={product?.name || `Материал ${index + 1}`}>
    <div className={styles.cardTop}><span className="overline">ВАРИАНТ {String(index + 1).padStart(2, '0')}</span><button className="icon-button" aria-label={`Убрать ${product?.name || `материал ${index + 1}`} из сравнения`} onClick={onRemove}><X size={18}/></button></div>
    {!current ? <div className={styles.loading} role="status">Загружаем материал…</div> : !product ? <div className={styles.failure}><h2>Материал не загружен</h2><p role="alert">{current.error || 'Материал недоступен'}</p><button className="btn btn-outline" onClick={() => setReload(value => value + 1)}><RefreshCw size={16}/> Повторить загрузку</button><Link href={`/product/${id}`} className="text-link">Открыть карточку</Link></div> : <>
      <div className={styles.image}><MaterialArt product={product}/></div>
      <div className={styles.title}><small>{categoryName(product.category)} · {product.unit}</small><h2><Link href={`/product/${product.id}`}>{product.name}</Link></h2></div>
      <div className={styles.purchase}>
        <div><label htmlFor={`compare-quantity-input-${id}`}><span>Количество</span></label><input id={`compare-quantity-input-${id}`} type="number" min="1" max="10000" step="1" value={quantityText} onChange={event => { setQuantityText(event.target.value); setAttempt(value => value + 1); }} aria-describedby={`compare-quantity-${id}`}/></div>
        <small id={`compare-quantity-${id}`}>{validQuantity ? `От 1 до 10 000 · ${product.unit}` : 'Укажите целое количество от 1 до 10 000'}</small>
        <div><label htmlFor={`compare-offer-${id}`}><span>Предложение</span></label><select id={`compare-offer-${id}`} value={offer?.id || ''} disabled={!eligible.length} onChange={event => { setSelection({ key: selectionKey, id: event.target.value }); setAttempt(value => value + 1); }}>
          {!offer && <option value="">Нет подходящего предложения</option>}
          {offers.map(value => <option value={value.id} key={value.id} disabled={!validQuantity || Boolean(unavailableReason(value, quantity, date))}>{value.supplierName} · {money(value.priceKopecks)} / {product.unit}{validQuantity && unavailableReason(value, quantity, date) ? ` · ${unavailableReason(value, quantity, date)}` : ''}</option>)}
        </select></div>
      </div>
      {offer ? <dl className={styles.details}>
        <div><dt>Склад</dt><dd>{offer.warehouseName || 'Название не указано'}<small>{offer.warehouseAddress || 'Адрес склада не указан'}</small></dd></div>
        <div><dt>На складе</dt><dd>{line?.stock ?? offer.stock} {product.unit}</dd></div>
        <div><dt>Ближайшая дата</dt><dd>{formatCalendarDate(line?.earliestDeliveryDate || offer.earliestDeliveryDate)}</dd></div>
        <div><dt>Цена за {product.unit}</dt><dd>{money(line?.priceKopecks ?? offer.priceKopecks)}</dd></div>
      </dl> : validQuantity && <div className={styles.failure} role="status"><b>Закупка недоступна</b>{offers.length ? <ul>{offers.map(value => <li key={value.id}>{value.supplierName}: {unavailableReason(value, quantity, date)}</li>)}</ul> : <p>У материала пока нет активных предложений.</p>}</div>}
      <div className={styles.calculation}>
        {!address.trim() && <p className="muted">Укажите общий адрес доставки для расчёта итога.</p>}
        {quoteKey && !quote && !quoteError && <p role="status">Проверяем наличие и доставку…</p>}
        {quoteError && <p className="form-error" role="alert">Не удалось рассчитать закупку. {quoteError}</p>}
        {quote && <>
          <dl className={styles.totals}><div><dt>Материалы</dt><dd>{money(quote.itemsTotalKopecks)}</dd></div><div><dt>Доставка</dt><dd>{money(quote.deliveryTotalKopecks)}</dd></div><div className={styles.total}><dt>Итого за вариант</dt><dd>{money(quote.totalKopecks)}</dd></div></dl>
          {quote.warnings.map((warning, i) => <p className="form-warning" key={i}>{warning}</p>)}
          {quote.unavailable.map(value => <p className="form-error" role="alert" key={value.offerId}>{value.reason}</p>)}
          {!quote.zoneAvailable && <p className="form-error" role="alert">Адрес вне демонстрационной зоны доставки Астрахани.</p>}
          {changedDate && <p className="form-error" role="alert">Ближайшая дата изменилась. Предложение не успевает к выбранному сроку.</p>}
          {!line && <p className="form-error" role="alert">Предложение изменилось. Обновите условия закупки.</p>}
        </>}
        <button className="btn btn-dark full" disabled={!canAdd} onClick={add}><ShoppingBag size={16}/> В корзину</button>
        <button className={`link-button ${styles.refresh}`} onClick={() => setReload(value => value + 1)}><RefreshCw size={14}/> Обновить условия</button>
      </div>
      <div className={styles.specs}><h3>Характеристики</h3>{Object.keys(product.specs || {}).length ? <dl className={styles.details}>{Object.entries(product.specs || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl> : <p className="muted">Характеристики не указаны.</p>}</div>
    </>}
  </article>;
}
