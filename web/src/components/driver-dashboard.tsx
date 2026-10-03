'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, MapPin, RefreshCw } from 'lucide-react';
import { api, type Coordinates, type DeparturePoint } from '@/lib/api';
import { formatCalendarDate } from '@/lib/calendar-date';
import { Status } from './orders';
import { MapPanel } from './route-map';
import styles from './driver-dashboard.module.css';

type DeliveryItem = { id: string; productName: string; quantity: number; unit: string };
type Delivery = { id: string; orderId: string; supplierName: string; status: string; scheduledDate?: string; address: string; destinationCoordinates?: Coordinates | null; departurePoints?: DeparturePoint[]; items?: DeliveryItem[] };
const next: Record<string, { status: string; label: string; notice: string }> = {
  assigned: { status: 'picked_up', label: 'Материалы загружены', notice: 'материалы загружены' },
  picked_up: { status: 'in_transit', label: 'Начать рейс', notice: 'рейс начат' },
  in_transit: { status: 'delivered', label: 'Доставка завершена', notice: 'доставка завершена' },
};
const activeStatuses = ['assigned', 'picked_up', 'in_transit'];

export function DriverDashboard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [view, setView] = useState<'active' | 'archive'>('active');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [completedId, setCompletedId] = useState('');
  const locked = useRef(false);
  const viewRef = useRef<'active' | 'archive'>('active');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await api<Delivery[]>('/driver/deliveries');
      setDeliveries(rows);
      setSelectedId(previous => {
        const group = rows.filter(row => viewRef.current === 'active' ? activeStatuses.includes(row.status) : ['delivered', 'cancelled'].includes(row.status));
        return group.some(row => row.id === previous) ? previous : group[0]?.id || '';
      });
      setStale(false);
    } catch (issue) {
      setStale(true);
      setError((issue as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const active = deliveries.filter(delivery => activeStatuses.includes(delivery.status));
  const archive = deliveries.filter(delivery => ['delivered', 'cancelled'].includes(delivery.status));
  const visible = view === 'active' ? active : archive;
  const selected = visible.find(delivery => delivery.id === selectedId) || visible[0];
  const changeView = (group: 'active' | 'archive', id = '') => {
    viewRef.current = group;
    setView(group);
    setSelectedId(id || (group === 'active' ? active : archive)[0]?.id || '');
  };

  const advance = async () => {
    if (!selected || !next[selected.status] || loading || stale || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setCompletedId('');
    const action = next[selected.status];
    try {
      await api(`/driver/deliveries/${selected.id}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action.status }),
      });
      setDeliveries(rows => rows.map(row => row.id === selected.id ? { ...row, status: action.status } : row));
      setNotice(`Рейс #${selected.id.slice(0, 8).toUpperCase()}: ${action.notice}.`);
      if (action.status === 'delivered') setCompletedId(selected.id);
      await load();
    } catch (issue) {
      // Событие могло сохраниться без ответа: сначала сверяем список рейсов.
      setStale(true);
      setError((issue as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return <section className={styles.workspace} aria-label="Рейсы водителя">
    <div className={styles.heading}><div><span className="overline">ВОДИТЕЛЬ / МОИ РЕЙСЫ</span><h2>Рейсы</h2></div><button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16}/> Обновить</button></div>
    <p className="muted">Выберите рейс и отметьте следующий этап. Статусы подтверждаются вручную; движение автомобиля не отслеживается.</p>
    <div className={styles.filters} aria-label="Группа рейсов"><button type="button" aria-pressed={view === 'active'} onClick={() => changeView('active')}>Активные ({active.length})</button><button type="button" aria-pressed={view === 'archive'} onClick={() => changeView('archive')}>Архив ({archive.length})</button></div>
    {notice && <div className={styles.notice} role="status"><p>{notice}</p>{completedId && <button className="btn btn-outline" onClick={() => changeView('archive', completedId)}>Открыть завершённый рейс</button>}</div>}
    {error && <div className={styles.notice} role="alert"><p>{error}</p><p>Обновите рейсы перед следующим действием, чтобы проверить актуальный статус.</p><button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}>Повторить загрузку</button></div>}
    {loading && <p role="status">Загружаем рейсы…</p>}
    {!loading && !error && !visible.length && <div className="empty-state">{view === 'active' ? 'Активных рейсов пока нет. Новые назначения появятся здесь.' : 'В архиве пока нет рейсов.'}</div>}
    {selected && <div className={styles.layout} aria-busy={loading || busy}>
      <div className={styles.list} aria-label="Выбор рейса">{visible.map(delivery => <button key={delivery.id} type="button" className={styles.trip} aria-pressed={selected.id === delivery.id} onClick={() => setSelectedId(delivery.id)}><span className="overline">РЕЙС #{delivery.id.slice(0, 8).toUpperCase()}</span><b>{delivery.supplierName}</b><small>{delivery.scheduledDate ? formatCalendarDate(delivery.scheduledDate) : 'Дата уточняется'}</small><Status status={delivery.status}/></button>)}</div>
      <div className={styles.detail}>
        <section className={styles.card} aria-label="Выбранный рейс">
          <div className={styles.cardHeading}><div><span className="overline">РЕЙС #{selected.id.slice(0, 8).toUpperCase()}</span><h3>{selected.supplierName}</h3></div><Status status={selected.status}/></div>
          <p className={styles.address}><MapPin size={18}/>{selected.address}</p>
          <div className={styles.meta}><span><CalendarDays size={16}/>{selected.scheduledDate ? formatCalendarDate(selected.scheduledDate) : 'Дата уточняется'}</span><span>Заказ #{selected.orderId.slice(0, 8)}</span></div>
          <div className={styles.cargo}>
            <h4>Материалы</h4>
            {selected.items?.length ? <ul className={styles.cargoList} aria-label="Материалы поставки">{selected.items.map(item => <li key={item.id} className={styles.cargoItem}><span className={styles.cargoName}>{item.productName}</span><span className={styles.cargoAmount}>{item.quantity.toLocaleString('ru-RU')}<small>{item.unit}</small></span></li>)}</ul> : <p className="muted">Состав поставки не указан.</p>}
          </div>
          {view === 'active' && next[selected.status] && <div className={styles.action}><span>Следующий этап выбранного рейса</span><button className="btn btn-dark" disabled={busy || loading || stale} onClick={() => void advance()}>{busy ? 'Сохраняем…' : next[selected.status].label}<ArrowRight size={16}/></button></div>}
        </section>
        <MapPanel key={selected.id} compact address={selected.address} destinationCoordinates={selected.destinationCoordinates} departurePoints={selected.departurePoints}/>
      </div>
    </div>}
  </section>;
}
