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
  if (raw == null || raw==='' || !Number.isFinite(value) || Math.abs(value)>max) throw new ApiError(400,'invalid_input',`${name}: неверная координата`);
  return value;
}

function lineString(value: string): number[][] {
  const match = /^LINESTRING\((.+)\)$/.exec(value);
  if (!match) return [];
  return match[1].split(',').map((point)=>point.trim().split(/\s+/).map(Number)).filter((point)=>point.length===2&&point.every(Number.isFinite));
}

@Controller('api/v1/geo')
export class GeoController {
  @Get('config') config() { return {mapKey:process.env.GIS_MAP_KEY||null,source:process.env.GIS_MAP_KEY?'2gis':'demo'}; }

  @Get('suggest') async suggest(@Query('q') raw: string) {
    const q = (raw||'').trim();
    if (q.length<2 || q.length>100) throw new ApiError(400,'invalid_input','Введите от 2 до 100 символов адреса');
    const key = process.env.DADATA_API_KEY;
    if (!key) return {source:'demo',items:demoAddresses.filter((address)=>address.value.toLowerCase().includes(q.toLowerCase()))};
    try {
      const response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Token ${key}`},body:JSON.stringify({query:q,count:8}),signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error(`DaData ${response.status}`);
      const data = await response.json() as {suggestions?:Array<{value:string;data?:{geo_lon?:string;geo_lat?:string}}>};
      return {source:'dadata',items:(data.suggestions||[]).map((item)=>({value:item.value,coordinates:item.data?.geo_lon&&item.data?.geo_lat?[Number(item.data.geo_lon),Number(item.data.geo_lat)]:null}))};
    } catch (error) { console.error('DaData request failed',error); throw new ApiError(502,'geocoding_unavailable','Сервис адресных подсказок временно недоступен'); }
  }

  @Get('route') async route(@Query() query: Record<string,string>) {
    const fromLon=coordinate(query.fromLon,'fromLon',180),fromLat=coordinate(query.fromLat,'fromLat',90);
    const toLon=coordinate(query.toLon,'toLon',180),toLat=coordinate(query.toLat,'toLat',90);
    const key = process.env.GIS_ROUTING_KEY;
    if (!key) return {source:'demo',coordinates:[[fromLon,fromLat],[(fromLon+toLon)/2+0.004,(fromLat+toLat)/2],[toLon,toLat]],distanceMeters:null,durationSeconds:null,note:'Схематический маршрут, не предназначенный для навигации'};
    try {
      const response=await fetch(`https://routing.api.2gis.com/routing/7.0.0/global?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:[{type:'stop',lon:fromLon,lat:fromLat},{type:'stop',lon:toLon,lat:toLat}],transport:'driving',output:'detailed',route_mode:'fastest',traffic_mode:'jam',locale:'ru'}),signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error(`2GIS ${response.status}`);
      const data = await response.json() as {result?:Array<{total_distance:number;total_duration:number;maneuvers?:Array<{outcoming_path?:{geometry?:Array<{selection:string}>}}>}>};
      const route=data.result?.[0];
      if (!route) throw new Error('No route');
      const coordinates=route.maneuvers?.flatMap((m)=>m.outcoming_path?.geometry?.flatMap((g)=>lineString(g.selection))||[])||[];
      if (coordinates.length<2) throw new Error('2GIS response has no route geometry');
      return {source:'2gis',coordinates,distanceMeters:route.total_distance,durationSeconds:route.total_duration};
    } catch (error) { console.error('2GIS routing request failed',error); throw new ApiError(502,'routing_unavailable','Сервис маршрутов временно недоступен'); }
  }
}
