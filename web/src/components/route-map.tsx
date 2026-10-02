'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api, isCoordinates, type Coordinates, type DeparturePoint } from '@/lib/api';
import styles from './route-map.module.css';

type Route = { source: 'demo' | '2gis'; coordinates: Coordinates[]; distanceMeters?: number | null; durationSeconds?: number | null };
function readRoute(value: Route): Route {
  if (!value || !['demo', '2gis'].includes(value.source) || !Array.isArray(value.coordinates) || value.coordinates.length < 2 || !value.coordinates.every(isCoordinates)) throw new Error('Сервис вернул некорректную геометрию маршрута');
  return value;
}
function RouteDrawing({ route }: { route: Route | null }) {
  const points = route?.coordinates || [];
  const lons = points.map(point => point[0]), lats = points.map(point => point[1]);
  const minLon = Math.min(...lons), minLat = Math.min(...lats);
  const width = Math.max(...lons) - minLon, height = Math.max(...lats) - minLat;
  const fittedScale = Math.min(width ? 340 / width : Infinity, height ? 160 / height : Infinity);
  const scale = Number.isFinite(fittedScale) ? fittedScale : 1;
  const projected = points.map(([lon, lat]) => [230 + (lon - minLon - width / 2) * scale, 130 - (lat - minLat - height / 2) * scale]);
  return <svg className="demo-map" viewBox="0 0 460 260" role="img" aria-label={route ? 'Геометрия выбранного участка доставки' : 'Точки маршрута пока не заданы'}>
    <rect width="460" height="260" fill="var(--map-ground)"/>
    <path d="M0 65H460 M0 130H460 M0 195H460 M115 0V260 M230 0V260 M345 0V260" stroke="var(--map-line)" opacity=".5"/>
    {projected.length > 1 && <><polyline data-testid="route-geometry" points={projected.map(point => point.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinejoin="round"/>{[projected[0], projected[projected.length - 1]].map(([x,y], index) => <g key={index}><circle cx={x} cy={y} r="8" fill={index ? 'var(--ink)' : 'var(--accent)'} stroke="var(--map-ground)" strokeWidth="3"/><text x={x} y={y + 24} textAnchor="middle" fill="var(--ink)" fontSize="12">{index ? 'Доставка' : 'Склад'}</text></g>)}</>}
    {!route && <text x="230" y="130" textAnchor="middle" fill="var(--muted)" fontSize="14">Нет схемы маршрута</text>}
  </svg>;
}

export function MapPanel({ address, destinationCoordinates, departurePoints = [], compact = false }: { address?: string; destinationCoordinates?: Coordinates | null; departurePoints?: DeparturePoint[]; compact?: boolean }) {
  const [warehouseId, setWarehouseId] = useState('');
  const warehouse = departurePoints.find(point => point.warehouseId === warehouseId) || departurePoints[0];
  const from = isCoordinates(warehouse?.coordinates) ? warehouse.coordinates : null;
  const to = isCoordinates(destinationCoordinates) ? destinationCoordinates : null;
  const pairKey = from && to ? JSON.stringify([from, to]) : '';
  const [result, setResult] = useState<{ key: string; route?: Route; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mapKey, setMapKey] = useState<string | null>(process.env.NEXT_PUBLIC_MAPGL_KEY || null);
  const [liveKey, setLiveKey] = useState('');
  const [mapError, setMapError] = useState('');
  const mapRef = useRef<HTMLDivElement>(null);
  const route = result?.key === pairKey ? result.route || null : null;
  const error = result?.key === pairKey ? result.error : null;
  useEffect(() => { const controller = new AbortController(); api<{mapKey:string|null}>('/geo/config', {signal:controller.signal}).then(data => { if (!controller.signal.aborted && data.mapKey) setMapKey(data.mapKey); }).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!pairKey) return;
    const [start, end] = JSON.parse(pairKey) as [Coordinates, Coordinates];
    const controller = new AbortController();
    setResult(null);
    api<Route>(`/geo/route?fromLon=${start[0]}&fromLat=${start[1]}&toLon=${end[0]}&toLat=${end[1]}`, {signal:controller.signal})
      .then(readRoute).then(value => { if (!controller.signal.aborted) setResult({key:pairKey, route:value}); })
      .catch(issue => { if (!controller.signal.aborted) setResult({key:pairKey, error:(issue as Error).message}); });
    return () => controller.abort();
  }, [pairKey, attempt]);
  useEffect(() => {
    setLiveKey('');setMapError('');
    if (!mapKey || !route || !mapRef.current) return;
    let cancelled = false;
    let map: {destroy:()=>void} | undefined, polyline: {destroy:()=>void} | undefined;
    import('@2gis/mapgl').then(module => module.load()).then(mapgl => {
      if (cancelled || !mapRef.current) return;
      const longitudes = route.coordinates.map(point => point[0]), latitudes = route.coordinates.map(point => point[1]);
      const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes), minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
      const span = Math.max(maxLon-minLon, maxLat-minLat);
      map = new mapgl.Map(mapRef.current, {key:mapKey, center:[(minLon+maxLon)/2,(minLat+maxLat)/2], zoom:Math.max(2, Math.min(15, Math.log2(360 / Math.max(span, .01))-2))});
      polyline = new mapgl.Polyline(map as InstanceType<typeof mapgl.Map>, {coordinates:route.coordinates, width:5, color:'#c26738'});
      setLiveKey(pairKey);
    }).catch(() => { if (!cancelled) setMapError('Подложка 2ГИС недоступна. Геометрия маршрута показана на координатной сетке.'); });
    return () => { cancelled = true; polyline?.destroy();map?.destroy(); };
  }, [mapKey, route, pairKey]);
  const missing = !to ? 'Точка доставки не выбрана. Выберите адрес из подсказки при оформлении заказа; ручной адрес допустим без карты.' : !warehouse ? 'В поставке нет сохранённых складов отправления.' : !from ? 'У выбранного склада нет координат. Участок нельзя построить.' : '';
  return <section className={`map-panel ${compact ? 'compact' : ''} ${styles.panel}`} aria-label="Карта поставки">
    <div className="map-panel-head"><span className="overline">УЧАСТОК ДОСТАВКИ</span><span className="mode-label">{route?.source === '2gis' ? 'Маршрут 2ГИС' : 'Схема доставки'}</span></div>
    {departurePoints.length > 1 && <label className={styles.control}>Склад отправления<select value={warehouse?.warehouseId || ''} onChange={event => setWarehouseId(event.target.value)}>{departurePoints.map(point => <option key={point.warehouseId} value={point.warehouseId}>{point.name} — {point.address}</option>)}</select><small>Показан один участок. Объезд всех складов и оптимальный маршрут не рассчитываются.</small></label>}
    <div className="map-stage">{mapKey && route && <div ref={mapRef} className="live-map" style={{visibility:liveKey === pairKey ? 'visible' : 'hidden'}}/>}{(!route || liveKey !== pairKey) && <RouteDrawing route={route}/>}</div>
    <div className={`map-panel-footer ${styles.footer}`}>
      <span><MapPin size={15}/>{warehouse ? `${warehouse.name} → точка доставки` : 'Точки поставки'}</span>
      {warehouse && <small>Отправление: {warehouse.address}</small>}{address && <small>Доставка: {address}</small>}
      {missing && <small role="status">{missing}</small>}{pairKey && !route && !error && <small role="status">Строим участок доставки…</small>}
      {error && <div><p className="form-error" role="alert">{error}</p><button type="button" className="btn btn-outline" onClick={() => {setResult(null);setAttempt(value => value + 1);}}>Повторить маршрут</button></div>}
      {route && <small>{route.source === 'demo' ? 'Демонстрационная схема между выбранными точками, без расчёта расстояния и времени. Не предназначена для навигации.' : 'Геометрия получена от Routing API 2ГИС; пригодность для грузового транспорта не проверяется.'} {liveKey !== pairKey ? 'Координатная сетка не изображает улицы.' : ''}</small>}
      {route?.source === '2gis' && <small>{typeof route.distanceMeters === 'number' && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0 ? `Расстояние: ${(route.distanceMeters / 1000).toFixed(1)} км. ` : ''}{typeof route.durationSeconds === 'number' && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 ? `Время: ${Math.ceil(route.durationSeconds / 60)} мин.` : ''}</small>}
      {mapError && <small role="status">{mapError}</small>}<small>Движение автомобиля не показано; GPS не используется.</small>
    </div>
  </section>;
}
