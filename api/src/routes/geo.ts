import { Controller, Get, Query } from '@nestjs/common';
import { ApiError } from '../security';

const demoAddresses = [
  {value:'Астрахань, ул. Савушкина, 6',coordinates:[48.057,46.371]},
  {value:'Астрахань, ул. Адмиралтейская, 14',coordinates:[48.035,46.351]},
  {value:'Астрахань, ул. Рождественского, 17',coordinates:[48.033,46.284]},
  {value:'Астрахань, ул. Магистральная, 16',coordinates:[48.003,46.351]},
];

function coordinate(raw: unknown, name: string, max: number): number {
  const value = Number(raw);
  if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(value) || Math.abs(value)>max) throw new ApiError(400,'invalid_input',`${name}: неверная координата`);
  return value;
}

function record(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response object');
  return value as Record<string,unknown>;
}

function externalCoordinate(raw: unknown, max: number): number {
  if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim())) throw new Error('Invalid coordinate');
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value)>max) throw new Error('Invalid coordinate');
  return value;
}

function lineString(value: unknown): number[][] {
  if (typeof value !== 'string') throw new Error('Invalid geometry');
  const match = /^LINESTRING\((.+)\)$/.exec(value);
  if (!match) throw new Error('Invalid geometry');
  // Не удаляем повреждённые точки: иначе обрывок пути выглядит рабочим маршрутом.
  const points = match[1].split(',').map((point)=>{
    const pair=point.trim().split(/\s+/);
    if (pair.length!==2) throw new Error('Invalid geometry point');
    return [externalCoordinate(pair[0],180),externalCoordinate(pair[1],90)];
  });
  if (points.length<2) throw new Error('Invalid geometry');
  return points;
}

function metric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value<0) throw new Error('Invalid route metric');
  return value;
}

@Controller('api/v1/geo')
export class GeoController {
  @Get('config') config() { return {mapKey:process.env.GIS_MAP_KEY||null,source:process.env.GIS_MAP_KEY?'2gis':'demo'}; }

  @Get('suggest') async suggest(@Query('q') raw: string) {
    if (typeof raw !== 'string') throw new ApiError(400,'invalid_input','Введите от 2 до 100 символов адреса');
    const q = raw.trim();
    if (q.length<2 || q.length>100) throw new ApiError(400,'invalid_input','Введите от 2 до 100 символов адреса');
    const key = process.env.DADATA_API_KEY;
    if (!key) return {source:'demo',items:demoAddresses.filter((address)=>address.value.toLowerCase().includes(q.toLowerCase()))};
    try {
      const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Token ${key}`},body:JSON.stringify({query:q,count:8}),signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error(`DaData ${response.status}`);
      const data = record(await response.json());
      if (!Array.isArray(data.suggestions)) throw new Error('Invalid suggestions');
      const items=data.suggestions.map((rawItem)=>{
        const item=record(rawItem);
        if (typeof item.value !== 'string' || !item.value.trim()) throw new Error('Invalid address');
        const addressData=item.data==null?{}:record(item.data);
        const lon=addressData.geo_lon,lat=addressData.geo_lat;
        const missing=(value:unknown)=>value==null||value==='';
        const coordinates=missing(lon)&&missing(lat)?null:[externalCoordinate(lon,180),externalCoordinate(lat,90)];
        return {value:item.value,coordinates};
      });
      return {source:'dadata',items};
    } catch { console.error('DaData request failed'); throw new ApiError(502,'geocoding_unavailable','Сервис адресных подсказок временно недоступен'); }
  }

  @Get('route') async route(@Query() query: Record<string,string>) {
    const fromLon=coordinate(query.fromLon,'fromLon',180),fromLat=coordinate(query.fromLat,'fromLat',90);
    const toLon=coordinate(query.toLon,'toLon',180),toLat=coordinate(query.toLat,'toLat',90);
    const key = process.env.GIS_ROUTING_KEY;
    if (!key) return {source:'demo',coordinates:[[fromLon,fromLat],[Math.min(180,(fromLon+toLon)/2+0.004),(fromLat+toLat)/2],[toLon,toLat]],distanceMeters:null,durationSeconds:null,note:'Схематический маршрут, не предназначенный для навигации'};
    try {
      const response=await fetch(`https://routing.api.2gis.com/routing/7.0.0/global?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:[{type:'stop',lon:fromLon,lat:fromLat},{type:'stop',lon:toLon,lat:toLat}],transport:'driving',output:'detailed',route_mode:'fastest',traffic_mode:'jam',locale:'ru'}),signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error(`2GIS ${response.status}`);
      const data = record(await response.json());
      if (!Array.isArray(data.result) || !data.result.length) throw new Error('No route');
      const route=record(data.result[0]);
      if (!Array.isArray(route.maneuvers)) throw new Error('Invalid maneuvers');
      const maneuvers=route.maneuvers;
      const coordinates=maneuvers.flatMap((rawManeuver,index)=>{
        const maneuver=record(rawManeuver);
        // Только завершающий манёвр может не содержать следующего участка пути.
        if (maneuver.outcoming_path==null) {
          if (index!==maneuvers.length-1) throw new Error('Missing route segment');
          return [];
        }
        const path=record(maneuver.outcoming_path);
        if (!Array.isArray(path.geometry) || !path.geometry.length) throw new Error('Invalid geometry');
        return path.geometry.flatMap((geometry)=>lineString(record(geometry).selection));
      });
      if (coordinates.length<2) throw new Error('2GIS response has no route geometry');
      return {source:'2gis',coordinates,distanceMeters:metric(route.total_distance),durationSeconds:metric(route.total_duration)};
    } catch { console.error('2GIS routing request failed'); throw new ApiError(502,'routing_unavailable','Сервис маршрутов временно недоступен'); }
  }
}
