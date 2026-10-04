'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, Plus, RefreshCw } from 'lucide-react';
import { api, money, quantityUnit, type Product } from '@/lib/api';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import styles from './supplier-dashboard.module.css';

type Offer = {
  id: string;
  productId: string;
  productName: string;
  productUnit: string;
  warehouseId: string;
  warehouseName: string;
  priceKopecks: number;
  stock: number;
  deliveryDays: number;
  deliveryCostKopecks: number;
  active: boolean;
};
type Warehouse = { id: string; name: string };
type Draft = {
  price: string;
  stock: string;
  days: string;
  delivery: string;
  active: boolean;
  productId: string;
  warehouseId: string;
};
type Editor = { original: Offer | null; draft: Draft; reconcile: boolean };
const maximum = 2147483647;
const filters = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Активные' },
  { id: 'hidden', label: 'Скрытые' },
  { id: 'empty', label: 'Нет в наличии' },
] as const;
type Filter = (typeof filters)[number]['id'];
const matches = (offer: Offer, filter: Filter) =>
  filter === 'all' ||
  (filter === 'active' ? offer.active : filter === 'hidden' ? !offer.active : offer.stock === 0);
const toDraft = (offer: Offer): Draft => ({
  price: String(offer.priceKopecks / 100),
  stock: String(offer.stock),
  days: String(offer.deliveryDays),
  delivery: String(offer.deliveryCostKopecks / 100),
  active: offer.active,
  productId: offer.productId,
  warehouseId: offer.warehouseId,
});
const integer = (value: string) =>
  /^\d+$/.test(value) && Number(value) <= maximum ? Number(value) : null;
const kopecks = (value: string) => {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const [rubles, fraction = ''] = value.replace(',', '.').split('.');
  const result = Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result <= maximum ? result : null;
};

export function SupplierDashboard() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState('');
  const [productRetry, setProductRetry] = useState(0);
  const locked = useRef(false);
  const loadingRef = useRef(false);
  const close = () => {
    if (!locked.current) setEditor(null);
  };
  const dialogRef = useDialogFocus(!!editor, close);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const [rows, places] = await Promise.all([
        api<Offer[]>('/supplier/offers'),
        api<Warehouse[]>('/supplier/warehouses'),
      ]);
      setOffers(rows);
      setWarehouses(places);
      setStale(false);
      return true;
    } catch (issue) {
      setStale(true);
      setError(`Не удалось обновить ассортимент: ${(issue as Error).message}`);
      return false;
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const creating = editor !== null && editor.original === null;
  useEffect(() => {
    if (!creating) return;
    let current = true;
    setProductLoading(true);
    setProductError('');
    const timeout = setTimeout(() => {
      api<{ items: Product[]; total: number }>(
        `/products?q=${encodeURIComponent(productQuery.trim())}&limit=100`,
      )
        .then((result) => {
          if (current) {
            setProducts(result.items);
            setProductTotal(result.total);
          }
        })
        .catch((issue) => {
          if (current) {
            setProducts([]);
            setProductError((issue as Error).message);
          }
        })
        .finally(() => {
          if (current) setProductLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [creating, productQuery, productRetry]);

  const open = (offer: Offer | null) => {
    if (locked.current || loadingRef.current || stale) return;
    setError('');
    setNotice('');
    setProductQuery('');
    setProducts([]);
    setEditor({
      original: offer,
      reconcile: false,
      draft: offer
        ? toDraft(offer)
        : {
            price: '',
            stock: '',
            days: '2',
            delivery: '0',
            active: true,
            productId: '',
            warehouseId: warehouses[0]?.id || '',
          },
    });
  };
  const change = (value: Partial<Draft>) => {
    if (!locked.current)
      setEditor((previous) =>
        previous ? { ...previous, draft: { ...previous.draft, ...value } } : previous,
      );
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || locked.current || loadingRef.current || stale || editor.reconcile) return;
    const { original, draft } = editor;
    const values = {
      priceKopecks: kopecks(draft.price),
      stock: integer(draft.stock),
      deliveryDays: integer(draft.days),
      deliveryCostKopecks: kopecks(draft.delivery),
    };
    if (
      Object.values(values).some((value) => value === null) ||
      values.priceKopecks === 0 ||
      (!original &&
        (!draft.productId || !warehouses.some((place) => place.id === draft.warehouseId)))
    ) {
      setError(
        'Заполните все поля. Цена должна быть положительной, остаток и срок — целыми, суммы — с точностью до копейки. Максимум: 2 147 483 647 единиц или копеек.',
      );
      return;
    }
    const body: Record<string, unknown> = original
      ? {}
      : { ...values, productId: draft.productId, warehouseId: draft.warehouseId };
    if (original) {
      for (const key of Object.keys(values) as Array<keyof typeof values>)
        if (values[key] !== original[key]) body[key] = values[key];
      if (draft.active !== original.active) body.active = draft.active;
      if ('stock' in body) body.expectedStock = original.stock;
      if (!Object.keys(body).length) {
        setEditor(null);
        setNotice('Изменений нет.');
        return;
      }
    }
    const id = original?.id;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(id ? `/supplier/offers/${id}` : '/supplier/offers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setEditor(null);
      setNotice(id ? 'Предложение сохранено.' : 'Предложение создано.');
      await load();
    } catch (issue) {
      // Запись могла пройти до потери ответа. GET не меняет исходный остаток черновика.
      setStale(true);
      setEditor((previous) => (previous ? { ...previous, reconcile: true } : previous));
      await load();
      setError(
        `Сохранение не подтверждено: ${(issue as Error).message}. Сверьте сохранённые значения перед следующим действием.`,
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const visible = offers.filter(
    (offer) =>
      matches(offer, filter) &&
      `${offer.productName} ${offer.warehouseName}`
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const saved = editor?.original ? offers.find((offer) => offer.id === editor.original!.id) : null;
  const disabled = busy || loading || stale;

  return (
    <section className={styles.workspace} aria-label="Ассортимент поставщика">
      <div className={styles.heading}>
        <div>
          <span className="overline">ПОСТАВЩИК / АССОРТИМЕНТ</span>
          <h2>Мои предложения</h2>
          <p className="muted">
            Цена, доступный остаток и условия поставки. Изменения не влияют на оформленные заказы.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className="btn btn-outline"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} /> Обновить
          </button>
          <button
            className="btn btn-dark"
            disabled={disabled || !warehouses.length}
            onClick={() => open(null)}
          >
            <Plus size={16} /> Предложение
          </button>
        </div>
      </div>
      {error && !editor && (
        <p className={styles.message} role="alert">
          {error}
          {stale && (
            <button
              className="btn btn-outline"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              Повторить загрузку
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className={styles.message} role="status">
          {notice}
        </p>
      )}
      {!loading && !warehouses.length && !stale && (
        <p className={styles.message}>Для нового предложения нужен склад вашей организации.</p>
      )}
      <div className={styles.toolbar}>
        <label>
          Поиск по товару или складу
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Например, цемент"
          />
        </label>
        <div className={styles.filters} aria-label="Фильтр предложений">
          {filters.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} ({offers.filter((offer) => matches(offer, item.id)).length})
            </button>
          ))}
        </div>
      </div>
      {loading && <p role="status">Загружаем предложения…</p>}
      <div className={styles.list}>
        {visible.map((offer) => (
          <article className={styles.card} key={offer.id}>
            <div className={styles.cardHeading}>
              <Package size={22} />
              <div>
                <h3>{offer.productName}</h3>
                <p>
                  {offer.warehouseName ||
                    warehouses.find((place) => place.id === offer.warehouseId)?.name ||
                    'Склад'}
                </p>
              </div>
              <span className={styles.badge}>{offer.active ? 'Активно' : 'Скрыто'}</span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Цена</dt>
                <dd>
                  {money(offer.priceKopecks)} / {offer.productUnit}
                </dd>
              </div>
              <div>
                <dt>Остаток</dt>
                <dd>{quantityUnit(offer.stock, offer.productUnit)}</dd>
              </div>
              <div>
                <dt>Доставка</dt>
                <dd>{money(offer.deliveryCostKopecks)}</dd>
              </div>
              <div>
                <dt>Срок</dt>
                <dd>{offer.deliveryDays} дн.</dd>
              </div>
            </dl>
            <button className="btn btn-outline" disabled={disabled} onClick={() => open(offer)}>
              Изменить
            </button>
          </article>
        ))}
      </div>
      {!loading && !stale && !visible.length && (
        <p className={styles.message}>
          {offers.length
            ? 'По этим условиям предложений нет. Измените поиск или фильтр.'
            : 'Предложений пока нет. Добавьте товар со своего склада.'}
        </p>
      )}
      {editor && (
        <div className="modal-backdrop">
          <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-editor-title"
            tabIndex={-1}
          >
            <div className={styles.heading}>
              <h2 id="supplier-editor-title">
                {editor.original ? 'Изменить предложение' : 'Новое предложение'}
              </h2>
              <button className="btn btn-outline" disabled={busy} onClick={close}>
                Закрыть
              </button>
            </div>
            {editor.original && (
              <p>
                {editor.original.productName} · {editor.original.warehouseName}
              </p>
            )}
            <form onSubmit={save}>
              <fieldset disabled={busy} className={styles.form}>
                {creating && (
                  <>
                    <label>
                      Поиск товара
                      <input
                        type="search"
                        value={productQuery}
                        onChange={(event) => {
                          setProductQuery(event.target.value);
                          change({ productId: '' });
                        }}
                        placeholder="Название или описание"
                      />
                    </label>
                    {productLoading ? (
                      <p role="status">Ищем товары…</p>
                    ) : productError ? (
                      <div role="alert">
                        <p>{productError}</p>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => setProductRetry((value) => value + 1)}
                        >
                          Повторить поиск товаров
                        </button>
                      </div>
                    ) : (
                      <p className="muted">
                        Найдено: {productTotal}.
                        {productTotal > 100 ? ' Показаны первые 100. Уточните поиск.' : ''}
                      </p>
                    )}
                    <label>
                      Товар
                      <select
                        required
                        disabled={productLoading}
                        value={editor.draft.productId}
                        onChange={(event) => change({ productId: event.target.value })}
                      >
                        <option value="">Выберите товар</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} · {product.unit}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Склад
                      <select
                        required
                        value={editor.draft.warehouseId}
                        onChange={(event) => change({ warehouseId: event.target.value })}
                      >
                        {warehouses.map((place) => (
                          <option key={place.id} value={place.id}>
                            {place.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <OfferFields draft={editor.draft} change={change} />
                <p className={styles.hint}>
                  Остаток — количество, доступное для новых заказов
                  {editor.original?.productUnit
                    ? `, единица: ${editor.original.productUnit}`
                    : products.find((product) => product.id === editor.draft.productId)?.unit
                      ? `, единица: ${products.find((product) => product.id === editor.draft.productId)!.unit}`
                      : ''}
                  . Оформление покупателя уменьшает его автоматически.
                </p>
                {editor.original && (
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={editor.draft.active}
                      onChange={(event) => change({ active: event.target.checked })}
                    />{' '}
                    Активно — показывать покупателям
                  </label>
                )}
              </fieldset>
              {error && (
                <p role="alert" className={styles.message}>
                  {error}
                  {stale && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={busy || loading}
                      onClick={() => void load()}
                    >
                      Повторить загрузку
                    </button>
                  )}
                </p>
              )}
              {editor.reconcile && (
                <div className={styles.reconcile}>
                  <h3>Сохранённые значения</h3>
                  {stale || loading ? (
                    <p>Дождитесь свежего списка предложений.</p>
                  ) : saved ? (
                    <>
                      <p>
                        Цена: {money(saved.priceKopecks)}; остаток:{' '}
                        {quantityUnit(saved.stock, saved.productUnit)}; доставка:{' '}
                        {money(saved.deliveryCostKopecks)}; срок: {saved.deliveryDays} дн.;{' '}
                        {saved.active ? 'активно' : 'скрыто'}.
                      </p>
                      <p>
                        Ваш черновик остаётся в полях выше. Загрузка сохранённых значений заменит
                        его и позволит начать новое изменение.
                      </p>
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={busy}
                        onClick={() => {
                          setEditor({ original: saved, draft: toDraft(saved), reconcile: false });
                          setError('');
                        }}
                      >
                        Загрузить сохранённые значения
                      </button>
                    </>
                  ) : editor.original ? (
                    <p>Предложение больше не найдено. Закройте редактор и проверьте ассортимент.</p>
                  ) : (
                    <>
                      <p>
                        Ответ создания мог потеряться после записи. Проверьте список: ниже показаны
                        предложения выбранного товара и склада. Новый запрос разрешается только как
                        отдельное действие.
                      </p>
                      {offers
                        .filter(
                          (offer) =>
                            offer.productId === editor.draft.productId &&
                            offer.warehouseId === editor.draft.warehouseId,
                        )
                        .map((offer) => (
                          <p key={offer.id}>
                            {offer.productName}: {money(offer.priceKopecks)},{' '}
                            {quantityUnit(offer.stock, offer.productUnit)}
                          </p>
                        ))}
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={busy}
                        onClick={() => {
                          setEditor(null);
                          setError('');
                        }}
                      >
                        Закрыть и проверить ассортимент
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className={styles.actions}>
                <button
                  type="submit"
                  className="btn btn-dark"
                  disabled={
                    disabled || editor.reconcile || (creating && (productLoading || !!productError))
                  }
                >
                  {busy ? 'Сохраняем…' : editor.original ? 'Сохранить' : 'Создать'}
                </button>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={close}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function OfferFields({ draft, change }: { draft: Draft; change: (value: Partial<Draft>) => void }) {
  return (
    <div className={styles.fields}>
      <label>
        Цена, ₽
        <input
          required
          inputMode="decimal"
          value={draft.price}
          onChange={(event) => change({ price: event.target.value })}
        />
      </label>
      <label>
        Остаток
        <input
          required
          inputMode="numeric"
          value={draft.stock}
          onChange={(event) => change({ stock: event.target.value })}
        />
      </label>
      <label>
        Срок, дней
        <input
          required
          inputMode="numeric"
          value={draft.days}
          onChange={(event) => change({ days: event.target.value })}
        />
      </label>
      <label>
        Доставка, ₽
        <input
          required
          inputMode="decimal"
          value={draft.delivery}
          onChange={(event) => change({ delivery: event.target.value })}
        />
      </label>
    </div>
  );
}
