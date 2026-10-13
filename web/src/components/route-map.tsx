'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api, isCoordinates, type Coordinates, type DeparturePoint } from '@/lib/api';
import styles from './route-map.module.css';
import { GeographicMap, type GeographicRoute } from './geographic-map';

type Route = GeographicRoute;
function readRoute(value: Route): Route {
  if (!value || !['demo', '2gis', 'osrm', 'prepared'].includes(value.source) || !Array.isArray(value.coordinates) || value.coordinates.length < 2 || !value.coordinates.every(isCoordinates)) throw new Error('Сервис вернул некорректную геометрию маршрута');
  return value;
}

export function MapPanel({ address, destinationCoordinates, departurePoints = [], compact = false }: { address?: string; destinationCoordinates?: Coordinates | null; departurePoints?: DeparturePoint[]; compact?: boolean }) {
  const [warehouseId, setWarehouseId] = useState('');
  const selectWarehouse = useCallback((id: string) => setWarehouseId(id), []);
  const warehouse = departurePoints.find(point => point.warehouseId === warehouseId) || departurePoints[0];
  const from = isCoordinates(warehouse?.coordinates) ? warehouse.coordinates : null;
  const [resolvedAddress, setResolvedAddress] = useState<{ address: string; coordinates: Coordinates } | null>(null);
  const to = isCoordinates(destinationCoordinates) ? destinationCoordinates : resolvedAddress && resolvedAddress.address === address ? resolvedAddress.coordinates : null;
  useEffect(() => {
    if (destinationCoordinates !== undefined || !address || address.trim().length < 2) return;
    const controller = new AbortController();
    api<{ items: { value: string; coordinates: Coordinates | null }[] }>(`/geo/suggest?q=${encodeURIComponent(address)}`, { signal: controller.signal }).then(data => {
      const match = data.items.find(item => item.value === address && isCoordinates(item.coordinates));
      if (!controller.signal.aborted && match && isCoordinates(match.coordinates)) setResolvedAddress({ address, coordinates: match.coordinates });
    }).catch(() => {});
    return () => controller.abort();
  }, [address, destinationCoordinates]);
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
    const markers: {destroy:()=>void}[] = [];
    import('@2gis/mapgl').then(module => module.load()).then(mapgl => {
      if (cancelled || !mapRef.current) return;
      const longitudes = route.coordinates.map(point => point[0]), latitudes = route.coordinates.map(point => point[1]);
      const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes), minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
      const span = Math.max(maxLon-minLon, maxLat-minLat);
      map = new mapgl.Map(mapRef.current, {key:mapKey, center:[(minLon+maxLon)/2,(minLat+maxLat)/2], zoom:Math.max(2, Math.min(15, Math.log2(360 / Math.max(span, .01))-2))});
      (map as InstanceType<typeof mapgl.Map>).on('error', () => { if (!cancelled) {setLiveKey('');setMapError('Подложка 2ГИС недоступна. Показана карта OpenStreetMap.');} });
      polyline = new mapgl.Polyline(map as InstanceType<typeof mapgl.Map>, {coordinates:route.coordinates, width:5, color:'#c24a16'});
      for (const point of departurePoints) if (isCoordinates(point.coordinates)) markers.push(new mapgl.Marker(map as InstanceType<typeof mapgl.Map>, {coordinates: point.coordinates}));
      if (to) markers.push(new mapgl.Marker(map as InstanceType<typeof mapgl.Map>, {coordinates: to}));
      setLiveKey(pairKey);
    }).catch(() => { if (!cancelled) setMapError('Подложка 2ГИС недоступна. Показана карта OpenStreetMap.'); });
    return () => { cancelled = true; markers.forEach(marker => marker.destroy());polyline?.destroy();map?.destroy(); };
  }, [mapKey, route, pairKey, departurePoints, to]);
  const missing = !to ? 'Точка доставки не выбрана. Выберите адрес из подсказки при оформлении заказа; ручной адрес допустим без точки.' : !warehouse ? (destinationCoordinates === undefined ? 'Точка строительного объекта.' : 'В поставке нет сохранённых складов отправления.') : !from ? 'У выбранного склада нет координат. Участок нельзя построить.' : '';
  return <section className={`map-panel ${compact ? 'compact' : ''} ${styles.panel}`} aria-label="Карта поставки">
    <div className="map-panel-head"><span className="overline">УЧАСТОК ДОСТАВКИ</span><span className="mode-label">{route?.source === '2gis' ? 'Маршрут 2ГИС' : route?.source === 'osrm' ? 'Маршрут OSRM' : route?.source === 'prepared' ? 'Подготовленный маршрут' : 'Карта поставки'}</span></div>
    {departurePoints.length > 1 && <label className={styles.control}>Склад отправления<select value={warehouse?.warehouseId || ''} onChange={event => setWarehouseId(event.target.value)}>{departurePoints.map(point => <option key={point.warehouseId} value={point.warehouseId}>{point.name} — {point.address}</option>)}</select><small>Показан один участок. Объезд всех складов и оптимальный маршрут не рассчитываются.</small></label>}
    <div className={`map-stage ${styles.stage}`}>{mapKey && route && <div ref={mapRef} className="live-map" style={{visibility:liveKey === pairKey ? 'visible' : 'hidden'}}/>}{(!route || liveKey !== pairKey) && <GeographicMap points={departurePoints} selectedId={warehouse?.warehouseId} destination={to} address={address} route={route} onSelect={selectWarehouse}/>}</div>
    <div className={`map-panel-footer ${styles.footer}`}>
      <span><MapPin size={15}/>{warehouse ? `${warehouse.name} → точка доставки` : 'Точки поставки'}</span>
      {warehouse && <small>Отправление: {warehouse.address}</small>}{address && <small>Доставка: {address}</small>}
      {missing && <small role="status">{missing}</small>}{resolvedAddress?.address === address && !destinationCoordinates && <small>Точка объекта найдена по точному адресу в справочнике.</small>}{pairKey && !route && !error && <small role="status">Строим участок доставки…</small>}
      {error && <div><p className="form-error" role="alert">{error}</p><button type="button" className="btn btn-outline" onClick={() => {setResult(null);setAttempt(value => value + 1);}}>Повторить маршрут</button></div>}
      {route && <small>{route.source === 'prepared' ? 'Сохранённый маршрут OSRM по дорогам OpenStreetMap. Не учитывает текущую обстановку.' : route.source === 'osrm' ? 'Маршрут OSRM по дорогам OpenStreetMap.' : route.source === '2gis' ? 'Маршрут Routing API 2ГИС.' : 'Схема между выбранными точками.'} Ограничения для грузового транспорта не проверяются.</small>}
      {route && <small>{typeof route.distanceMeters === 'number' && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0 ? `Расстояние: ${(route.distanceMeters / 1000).toFixed(1)} км. ` : ''}{typeof route.durationSeconds === 'number' && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 ? `Время: ${Math.ceil(route.durationSeconds / 60)} мин.` : ''}</small>}
      {mapError && <small role="status">{mapError}</small>}<small>Движение автомобиля не показано; GPS не используется.</small>
    </div>
  </section>;
}
