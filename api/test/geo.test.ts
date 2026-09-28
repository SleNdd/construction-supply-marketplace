import assert from 'node:assert/strict';
import test from 'node:test';
import { GeoController } from '../src/routes/geo';
import { ApiError } from '../src/security';

const query={fromLon:'48.057',fromLat:'46.371',toLon:'48.035',toLat:'46.351'};
const controller=new GeoController();
const validRoute=()=>({result:[{total_distance:1200,total_duration:180,maneuvers:[
  {outcoming_path:{geometry:[{selection:'LINESTRING(48.057 46.371,48.045 46.360)'}]}},
  {outcoming_path:{geometry:[{selection:'LINESTRING(48.045 46.360,48.035 46.351)'}]}},
  {},
]}]});
const response=(data:unknown,ok=true)=>({ok,status:ok?200:503,json:async()=>data}) as Response;
const unavailable=(code:string)=>(error:unknown)=>{
  assert.ok(error instanceof ApiError);
  assert.equal(error.status,502);
  assert.equal(error.code,code);
  return true;
};

// node:test запускает этот файл отдельно; внутри файла тесты идут последовательно.
async function isolated(keys:boolean,fetchStub:typeof fetch,run:(logs:unknown[][])=>Promise<void>) {
  const envNames=['DADATA_API_KEY','GIS_ROUTING_KEY','GIS_MAP_KEY'] as const;
  const saved=envNames.map((name)=>process.env[name]);
  const originalFetch=globalThis.fetch,originalError=console.error;
  const logs:unknown[][]=[];
  try {
    for (const name of envNames) {
      if (keys) process.env[name]='test-placeholder-key';
      else delete process.env[name];
    }
    globalThis.fetch=fetchStub;
    console.error=(...args:unknown[])=>{logs.push(args);};
    await run(logs);
  } finally {
    globalThis.fetch=originalFetch;
    console.error=originalError;
    envNames.forEach((name,index)=>{
      if (saved[index]===undefined) delete process.env[name];
      else process.env[name]=saved[index];
    });
  }
}

test('деморежим не обращается к внешним сервисам',async()=>{
  await isolated(false,async()=>{throw new Error('Unexpected network request');},async()=>{
    assert.deepEqual(controller.config(),{mapKey:null,source:'demo'});
    const suggestions=await controller.suggest('  Савушкина  ');
    assert.equal(suggestions.source,'demo');
    assert.equal(suggestions.items.length,1);
    assert.deepEqual(suggestions.items[0].coordinates,[48.057,46.371]);
    assert.deepEqual((await controller.suggest('Нет такого адреса')).items,[]);
    const route=await controller.route(query);
    assert.equal(route.source,'demo');
    assert.equal(route.distanceMeters,null);
    assert.equal(route.durationSeconds,null);
    assert.match(route.note!,/Схематический/);
    const boundary=await controller.route({...query,fromLon:'180',toLon:'180'});
    assert.ok(boundary.coordinates.every(([lon,lat])=>Math.abs(lon)<=180&&Math.abs(lat)<=90));
  });
});

test('невалидный ввод отклоняется до fetch даже при наличии ключей',async()=>{
  await isolated(true,async()=>{throw new Error('Unexpected network request');},async(logs)=>{
    const invalid=(error:unknown)=>error instanceof ApiError&&error.status===400&&error.code==='invalid_input';
    for (const q of ['', ' ', 'а', 'а'.repeat(101)]) await assert.rejects(controller.suggest(q),invalid);
    for (const q of [['Адрес','Другой адрес'],{q:'Адрес'},null]) await assert.rejects(controller.suggest(q as unknown as string),invalid);
    for (const [name,values] of Object.entries({fromLon:['',' ','NaN','Infinity','181'],fromLat:['91'],toLon:['-181'],toLat:['-91']})) {
      for (const value of values) await assert.rejects(controller.route({...query,[name]:value}),invalid);
    }
    await assert.rejects(controller.route({}),invalid);
    assert.deepEqual(logs,[]);
  });
});

test('DaData: подготовленные адреса и отсутствие геокода',async()=>{
  await isolated(true,async(url,options)=>{
    assert.equal(url,'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address');
    assert.equal(options?.method,'POST');
    assert.deepEqual(JSON.parse(options?.body as string),{query:'Астрахань',count:8});
    assert.equal((options?.headers as Record<string,string>).Authorization,'Token test-placeholder-key');
    assert.ok(options?.signal instanceof AbortSignal);
    return response({suggestions:[
      {value:'Адрес',data:{geo_lon:'48.057',geo_lat:'46.371'}},
      {value:'Без геокода',data:{geo_lon:null,geo_lat:null}},
      {value:'Без данных'},
      {value:'Граница',data:{geo_lon:'-180',geo_lat:'90'}},
    ]});
  },async()=>{
    assert.deepEqual(await controller.suggest(' Астрахань '),{source:'dadata',items:[
      {value:'Адрес',coordinates:[48.057,46.371]},
      {value:'Без геокода',coordinates:null},
      {value:'Без данных',coordinates:null},
      {value:'Граница',coordinates:[-180,90]},
    ]});
    assert.deepEqual(controller.config(),{mapKey:'test-placeholder-key',source:'2gis'});
  });
  await isolated(true,async()=>response({suggestions:[]}),async()=>{
    assert.deepEqual(await controller.suggest('Адрес'),{source:'dadata',items:[]});
  });
});

test('2ГИС: геометрия нескольких манёвров и метрики',async()=>{
  await isolated(true,async(url,options)=>{
    assert.equal(url,'https://routing.api.2gis.com/routing/7.0.0/global?key=test-placeholder-key');
    assert.equal(options?.method,'POST');
    assert.deepEqual(JSON.parse(options?.body as string).points,[{type:'stop',lon:48.057,lat:46.371},{type:'stop',lon:48.035,lat:46.351}]);
    assert.ok(options?.signal instanceof AbortSignal);
    return response(validRoute());
  },async()=>{
    assert.deepEqual(await controller.route(query),{source:'2gis',coordinates:[[48.057,46.371],[48.045,46.36],[48.045,46.36],[48.035,46.351]],distanceMeters:1200,durationSeconds:180});
  });
  const zero=validRoute();zero.result[0].total_distance=0;zero.result[0].total_duration=0;
  await isolated(true,async()=>response(zero),async()=>{
    const result=await controller.route(query);
    assert.equal(result.distanceMeters,0);
    assert.equal(result.durationSeconds,0);
  });
});

test('оба сервиса: HTTP, отказ fetch, тайм-аут и повреждённый JSON дают безопасную ошибку 502',async()=>{
  const failures:Array<typeof fetch>=[
    async()=>response({},false),
    async()=>{throw new Error('Authorization: Token secret https://example.test?key=secret');},
    async()=>{throw new DOMException('URL contains secret','TimeoutError');},
    async()=>({ok:true,json:async()=>{throw new SyntaxError('secret JSON');}} as unknown as Response),
  ];
  for (const stub of failures) await isolated(true,stub,async(logs)=>{
    await assert.rejects(controller.suggest('Адрес'),unavailable('geocoding_unavailable'));
    await assert.rejects(controller.route(query),unavailable('routing_unavailable'));
    assert.deepEqual(logs,[['DaData request failed'],['2GIS routing request failed']]);
  });
});

test('DaData: неверный формат и повреждённые координаты не становятся рабочими подсказками',async()=>{
  const invalid:unknown[]=[null,[],{}, {suggestions:{}},{suggestions:[null]}, {suggestions:[{value:10}]}, {suggestions:[{value:' '}]}, {suggestions:[{value:'Адрес',data:[]}]}];
  for (const [lon,lat] of [['NaN','46'],['Infinity','46'],['181','46'],['48','-91'],['48',null],[' ','46'],[true,'46'],[{},'46']]) {
    invalid.push({suggestions:[{value:'Адрес',data:{geo_lon:lon,geo_lat:lat}}]});
  }
  for (const data of invalid) await isolated(true,async()=>response(data),async()=>{
    await assert.rejects(controller.suggest('Адрес'),unavailable('geocoding_unavailable'));
  });
});

test('2ГИС: отсутствие пути, неверный формат, повреждённая геометрия и метрики дают 502',async()=>{
  const invalid:unknown[]=[null,[],{}, {result:[]},{result:{}},{result:[null]}, {result:[{total_distance:1,total_duration:1,maneuvers:[]}]}, {result:[{maneuvers:{}}]}];
  for (const selection of [null,10,'POINT(48 46)','LINESTRING(48 46)','LINESTRING(48 46,bad point,49 47)','LINESTRING(48 46,181 47)','LINESTRING(48 46,49 -91)','LINESTRING(48 46,NaN 47)','LINESTRING(48 46,Infinity 47)','LINESTRING(48 46,49 47 48)']) {
    const data=validRoute();
    (data.result[0].maneuvers[0].outcoming_path!.geometry[0] as {selection:unknown}).selection=selection;
    invalid.push(data);
  }
  // Повреждённый сегмент не скрывается за следующим, полностью валидным сегментом.
  invalid.push({result:[{total_distance:1,total_duration:1,maneuvers:[{outcoming_path:{geometry:{}}}]}]});
  const emptySegment=validRoute();emptySegment.result[0].maneuvers[0].outcoming_path!.geometry=[];
  invalid.push(emptySegment);
  const missingSegment=validRoute();delete missingSegment.result[0].maneuvers[0].outcoming_path;
  invalid.push(missingSegment);
  for (const field of ['total_distance','total_duration']) for (const value of [-1,NaN,Infinity,'120',null,undefined]) {
    const data=validRoute();
    (data.result[0] as Record<string,unknown>)[field]=value;
    invalid.push(data);
  }
  for (const data of invalid) await isolated(true,async()=>response(data),async()=>{
    await assert.rejects(controller.route(query),unavailable('routing_unavailable'));
  });
});
