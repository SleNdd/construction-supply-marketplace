'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation2, Truck } from 'lucide-react';
import { api } from '@/lib/api';

type Route = { source?: 'demo' | '2gis'; coordinates?: number[][]; distanceMeters?: number; durationSeconds?: number };
const ASTRAKHAN:[number,number]=[48.0336,46.3497];

export function MapPanel({ address, compact=false }: {address?:string;compact?:boolean}) {
  const mapRef=useRef<HTMLDivElement>(null);const [live,setLive]=useState(false);const [route,setRoute]=useState<Route|null>(null);const [mapKey,setMapKey]=useState<string|null>(process.env.NEXT_PUBLIC_MAPGL_KEY||null);
  useEffect(()=>{api<{mapKey:string|null}>('/geo/config').then(data=>{if(data.mapKey)setMapKey(data.mapKey);}).catch(()=>{});},[]);
  useEffect(()=>{api<Route>(`/geo/route?fromLon=48.025&fromLat=46.34&toLon=48.055&toLat=46.37`).then(setRoute).catch(()=>setRoute({source:'demo'}));},[]);
  useEffect(()=>{if(!mapKey||!mapRef.current||!route)return;let map:{destroy:()=>void}|undefined;let polyline:{destroy:()=>void}|undefined;let cancelled=false;
    import('@2gis/mapgl').then(module=>module.load()).then(mapgl=>{if(cancelled||!mapRef.current)return;map=new mapgl.Map(mapRef.current,{key:mapKey,center:ASTRAKHAN,zoom:11});if(route.coordinates&&route.coordinates.length>1)polyline=new mapgl.Polyline(map as InstanceType<typeof mapgl.Map>,{coordinates:route.coordinates,width:5,color:'#c26738'});setLive(true);}).catch(()=>setLive(false));
    return()=>{cancelled=true;polyline?.destroy();map?.destroy();};
  },[mapKey,route]);
  return <div className={compact?'map-panel compact':'map-panel'}><div className="map-panel-head"><span className="overline">СХЕМА РАЙОНА</span><span className="mode-label">Демонстрационный маршрут</span></div><div className="map-stage">{mapKey&&<div ref={mapRef} className="live-map"/>}{!live&&<svg className="demo-map" viewBox="0 0 460 260" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Схема демонстрационного маршрута по Астрахани"><rect width="460" height="260" fill="var(--map-ground)"/><path d="M-10 94 L470 40 M-10 173 L470 118 M-10 249 L470 195 M66 -10 L128 270 M205 -10 L268 270 M343 -10 L406 270" stroke="var(--map-street)" strokeWidth="15"/><path d="M-10 94 L470 40 M-10 173 L470 118 M-10 249 L470 195 M66 -10 L128 270 M205 -10 L268 270 M343 -10 L406 270" stroke="var(--map-line)" strokeWidth="2"/><path d="M-10 10 C100 120 160 78 260 174 S390 160 470 270" fill="none" stroke="var(--map-water)" strokeWidth="26" opacity=".65"/><path d="M72 203 C100 184 139 175 169 151 S234 121 269 118 S332 102 373 77" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 1"/><circle cx="72" cy="203" r="10" fill="var(--accent)" stroke="white" strokeWidth="4"/><circle cx="373" cy="77" r="10" fill="var(--ink)" stroke="white" strokeWidth="4"/><text x="28" y="232" fill="var(--muted)" fontSize="10" fontWeight="700">СКЛАД</text><text x="384" y="78" fill="var(--muted)" fontSize="10" fontWeight="700">ОБЪЕКТ</text></svg>}<span className="map-city">АСТРАХАНЬ</span></div><div className="map-panel-footer"><span><MapPin size={15}/>Маршрут между заданными точками</span><small>{live?'Карта 2ГИС. Маршрут проложен между демонстрационными точками.':'Схематический маршрут между демонстрационными точками.'} {address?'Адрес объекта: '+address+'. Демомаршрут к этому адресу не привязан. ':''}GPS не используется.</small></div></div>;
}
