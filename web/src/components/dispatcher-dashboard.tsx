'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, MapPin, RefreshCw } from 'lucide-react';
import { api, type Coordinates, type DeparturePoint } from '@/lib/api';
import { formatCalendarDate } from '@/lib/calendar-date';
import { Status } from './orders';
import { MapPanel } from './route-map';
import styles from './dispatcher-dashboard.module.css';

type Delivery = { id: string; orderId: string; supplierName: string; driverId?: string | null; driverName?: string | null; status: string; orderStatus: string; scheduledDate?: string | null; address: string; destinationCoordinates?: Coordinates | null; departurePoints?: DeparturePoint[] };
type Driver = { id: string; name: string };
type Draft = { driverId?: string; scheduledDate?: string };
const groups = [
  { id: 'planning', label: 'К планированию', statuses: ['pending', 'assigned'], empty: 'Поставок к планированию пока нет.' },
  { id: 'working', label: 'В работе', statuses: ['picked_up', 'in_transit'], empty: 'Поставок в работе пока нет.' },
  { id: 'archive', label: 'Архив', statuses: ['delivered', 'cancelled'], empty: 'В архиве пока нет поставок.' },
] as const;
type Group = typeof groups[number]['id'];
const inGroup = (row: Delivery, group: Group) => groups.find(item => item.id === group)!.statuses.some(status => status === row.status);

export function DispatcherDashboard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [view, setView] = useState<Group>('planning');
  const [selectedId, setSelectedId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const loadingRef = useRef(false);
  const selection = useRef({ view: 'planning' as Group, id: '' });
  const choose = (group: Group, id: string) => {
    selection.current = { view: group, id };
    setView(group);
    setSelectedId(id);
  };
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const [rows, people] = await Promise.all([api<Delivery[]>('/dispatch/deliveries'), api<Driver[]>('/dispatch/drivers')]);
      setDeliveries(rows);
      setDrivers(people);
      const previous = rows.find(row => row.id === selection.current.id);
      const group = previous ? groups.find(item => item.statuses.some(status => status === previous.status))?.id || selection.current.view : selection.current.view;
      const id = previous && inGroup(previous, group) ? previous.id : rows.find(row => inGroup(row, group))?.id || '';
      selection.current = { view: group, id };
      setView(group);
      setSelectedId(id);
      setStale(false);
    } catch (issue) {
      setStale(true);
      setError((issue as Error).message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = deliveries.filter(row => inGroup(row, view));
  const selected = visible.find(row => row.id === selectedId) || visible[0];
  const draft = selected ? drafts[selected.id] || {} : {};
  const driverId = draft.driverId ?? selected?.driverId ?? '';
  const scheduledDate = draft.scheduledDate ?? selected?.scheduledDate?.slice(0, 10) ?? '';
  const editable = selected && inGroup(selected, 'planning');
  const unpaid = selected?.orderStatus === 'awaiting_payment';
  const disabled = busy || loading || stale || unpaid;
  const changeDraft = (value: Draft) => {
    if (!selected || disabled) return;
    setDrafts(previous => ({ ...previous, [selected.id]: { ...previous[selected.id], ...value } }));
  };
  const assign = async () => {
    if (!selected || !editable || disabled || !driverId || locked.current || loadingRef.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const id = selected.id;
    const body = { driverId, scheduledDate: scheduledDate || null };
    try {
      await api(`/dispatch/deliveries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setDeliveries(rows => rows.map(row => row.id === id ? { ...row, ...body, driverName: drivers.find(driver => driver.id === body.driverId)?.name, status: 'assigned' } : row));
      setDrafts(previous => { const remaining = { ...previous }; delete remaining[id]; return remaining; });
      setNotice(`Назначение поставки #${id.slice(0, 8).toUpperCase()} сохранено.`);
      await load();
    } catch (issue) {
      // Ответ мог потеряться после записи: повтор разрешаем только после GET.
      setStale(true);
      setError((issue as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return <section className={styles.workspace} aria-label="Поставки диспетчера">
    <div className={styles.heading}><div><span className="overline">ДИСПЕТЧЕР / ЛОГИСТИКА</span><h2>План поставок</h2></div><button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16}/> Обновить</button></div>
    <p className="muted">Выберите поставку, назначьте водителя и при необходимости дату рейса. Этапы доставки водитель отмечает вручную.</p>
    <div className={styles.filters} aria-label="Группа поставок">{groups.map(group => <button type="button" key={group.id} aria-pressed={view === group.id} onClick={() => choose(group.id, selected && inGroup(selected, group.id) ? selected.id : deliveries.find(row => inGroup(row, group.id))?.id || '')}>{group.label} ({deliveries.filter(row => inGroup(row, group.id)).length})</button>)}</div>
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {error && <div className={styles.notice} role="alert"><p>{error}</p><p>Обновите поставки перед назначением, чтобы проверить актуальные данные.</p><button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}>Повторить загрузку</button></div>}
    {loading && <p role="status">Загружаем поставки…</p>}
    {!loading && !error && !visible.length && <div className="empty-state">{groups.find(group => group.id === view)!.empty}</div>}
    {selected && <div className={styles.layout} aria-busy={loading || busy}>
      <div className={styles.list} aria-label="Выбор поставки">{visible.map(row => <button className={styles.delivery} key={row.id} type="button" aria-pressed={selected.id === row.id} onClick={() => choose(view, row.id)}><span className="overline">ПОСТАВКА #{row.id.slice(0, 8).toUpperCase()}</span><b>{row.supplierName}</b><span>{row.address}</span><small>{row.scheduledDate ? formatCalendarDate(row.scheduledDate) : 'Дата не назначена'}</small><Status status={row.status}/></button>)}</div>
      <div className={styles.detail}>
        <section className={styles.card} aria-label="Выбранная поставка">
          <div className={styles.cardHeading}><div><span className="overline">ПОСТАВКА #{selected.id.slice(0, 8).toUpperCase()}</span><h3>{selected.supplierName}</h3></div><Status status={selected.status}/></div>
          <p className={styles.address}><MapPin size={18}/>{selected.address}</p>
          <div className={styles.meta}><span><CalendarDays size={16}/>{selected.scheduledDate ? formatCalendarDate(selected.scheduledDate) : 'Дата не назначена'}</span><span>Заказ #{selected.orderId.slice(0, 8)}</span><span>{selected.driverName || 'Водитель не назначен'}</span><span>Статус заказа: <Status status={selected.orderStatus}/></span></div>
          {editable && <div className={styles.plan}>
            <h4>{selected.status === 'assigned' ? 'Изменить назначение' : 'Назначение рейса'}</h4>
            {unpaid && <p className="muted">Для назначения требуется подтверждение оплаты заказа покупателем.</p>}
            <div className={styles.fields}><label>Водитель<select disabled={disabled} value={driverId} onChange={event => changeDraft({ driverId: event.target.value })}><option value="">Выберите водителя</option>{drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><label>Дата рейса<input type="date" aria-label="Дата рейса" aria-describedby="dispatch-date-hint" disabled={disabled} value={scheduledDate} onChange={event => changeDraft({ scheduledDate: event.target.value })}/><small id="dispatch-date-hint">Можно оставить без даты.</small></label></div>
            {!drivers.length && <p className="muted">Нет доступных водителей для назначения.</p>}
            <button className="btn btn-dark" disabled={disabled || !driverId} onClick={() => void assign()}>{busy ? 'Сохраняем…' : selected.status === 'assigned' ? 'Сохранить назначение' : 'Назначить'}<ArrowRight size={16}/></button>
          </div>}
        </section>
        <MapPanel key={selected.id} compact address={selected.address} destinationCoordinates={selected.destinationCoordinates} departurePoints={selected.departurePoints}/>
      </div>
    </div>}
  </section>;
}
