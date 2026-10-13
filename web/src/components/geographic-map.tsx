'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isCoordinates, type Coordinates, type DeparturePoint } from '@/lib/api';
import styles from './route-map.module.css';

export type GeographicRoute = { source: 'demo' | '2gis' | 'osrm' | 'prepared'; coordinates: Coordinates[]; distanceMeters?: number | null; durationSeconds?: number | null };

type Props = { points: DeparturePoint[]; selectedId?: string; destination: Coordinates | null; address?: string; route: GeographicRoute | null; onSelect: (id: string) => void };

export function GeographicMap({ points, selectedId, destination, address, route, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [offline, setOffline] = useState(false);
  const [issue, setIssue] = useState('');
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let resize: ResizeObserver | undefined;
    setOffline(false); setIssue('');
    import('leaflet').then(async L => {
      if (cancelled || !container.current) return;
      const map = L.map(container.current, { center: [46.35, 48.04], zoom: 12, scrollWheelZoom: false, attributionControl: true });
      mapRef.current = map;
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        referrerPolicy: 'strict-origin-when-cross-origin',
      }).addTo(map);
      let localRoads: ReturnType<typeof L.geoJSON> | undefined;
      try {
        const response = await fetch('/maps/astrakhan-roads.geojson', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
        if (!response.ok) throw new Error('No local roads');
        const roads = await response.json();
        if (cancelled) return;
        localRoads = L.geoJSON(roads, { style: { color: '#849494', weight: 2, opacity: .7 }, interactive: false }).addTo(map);
        localRoads.bringToBack();
      } catch { /* Онлайн-подложка работает независимо от локального фрагмента. */ }
      if (cancelled) return;
      tiles.on('tileerror', () => { if (!cancelled) setOffline(true); });
      const bounds: [number, number][] = [];
      for (const point of points) {
        if (!isCoordinates(point.coordinates)) continue;
        const latLng: [number, number] = [point.coordinates[1], point.coordinates[0]];
        bounds.push(latLng);
        const active = point.warehouseId === selectedId;
        const marker = L.marker(latLng, { title: point.name, keyboard: true, icon: L.divIcon({ className: styles.marker, html: `<span class="${active ? styles.activePin : styles.warehousePin}">С</span>`, iconSize: [34, 42], iconAnchor: [17, 42], popupAnchor: [0, -35] }) });
        const content = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = point.name;
        const text = document.createElement('p'); text.textContent = point.address;
        const select = document.createElement('button'); select.type = 'button'; select.textContent = active ? 'Выбранный склад' : 'Показать маршрут отсюда'; select.disabled = active;
        select.addEventListener('click', () => onSelect(point.warehouseId));
        content.append(title, text, select);
        marker.bindPopup(content).addTo(map);
        marker.getElement()?.setAttribute('data-testid', `warehouse-marker-${point.warehouseId}`);
      }
      if (destination) {
        const latLng: [number, number] = [destination[1], destination[0]]; bounds.push(latLng);
        const marker = L.marker(latLng, { title: 'Объект доставки', icon: L.divIcon({ className: styles.marker, html: `<span class="${styles.destinationPin}">О</span>`, iconSize: [34, 42], iconAnchor: [17, 42], popupAnchor: [0, -35] }) });
        const content = document.createElement('div'); const title = document.createElement('strong'); title.textContent = 'Объект доставки'; const text = document.createElement('p'); text.textContent = address || 'Выбранная точка'; content.append(title, text);
        marker.bindPopup(content).addTo(map); marker.getElement()?.setAttribute('data-testid', 'destination-marker');
      }
      if (route) {
        const coordinates = route.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
        const line = L.polyline(coordinates, { color: '#c24a16', weight: 5, opacity: .9 }).addTo(map);
        line.getElement()?.setAttribute('data-testid', 'route-geometry'); bounds.push(...coordinates);
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15, animate: false });
      resize = new ResizeObserver(() => map.invalidateSize()); resize.observe(container.current);
    }).catch(() => { if (!cancelled) setIssue('Не удалось загрузить карту. Адреса поставки доступны ниже.'); });
    return () => { cancelled = true; controller.abort(); resize?.disconnect(); mapRef.current?.remove(); mapRef.current = null; };
  }, [points, selectedId, destination, address, route, onSelect]);
  return <div className={styles.geographicStage}><div ref={container} className={styles.geographicMap} aria-label="Географическая карта складов и объекта"/>{offline && <span className={styles.offline} role="status">Подложка недоступна · сохранённые дорожные участки</span>}{issue && <p role="alert">{issue}</p>}</div>;
}
