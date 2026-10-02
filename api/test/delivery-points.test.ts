import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDestinationCoordinates, snapshotDeparturePoints } from '../src/delivery-points';
import { ApiError } from '../src/security';

test('точка назначения: необязательная, строго числовая, конечная, в диапазоне', () => {
  for (const input of [undefined, null]) assert.equal(parseDestinationCoordinates(input), null);
  for (const input of [[48.057,46.371],[-180,-90],[180,90],[0,0]]) {
    assert.deepEqual(parseDestinationCoordinates(input), input);
    assert.notEqual(parseDestinationCoordinates(input), input, 'входной массив не сохраняется по ссылке');
  }
  for (const input of [[], [48], [48,46,1], ['48',46], [48,'46'], [null,null], [NaN,46], [48,Infinity], [-181,46], [48,91], '48,46', {}, false]) {
    assert.throws(() => parseDestinationCoordinates(input), (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === 'invalid_input');
  }
});

test('снимок всех складов: уникальность, порядок и отсутствие ложных координат', () => {
  const row = {warehouse_id:'b',warehouse_name:'Склад Б',warehouse_address:'Адрес Б',warehouse_lon:'48.057000',warehouse_lat:'46.371000'};
  const result = snapshotDeparturePoints([row, {...row}, {...row,warehouse_id:'a',warehouse_name:'Склад А',warehouse_lon:null}]);
  assert.deepEqual(result,[{warehouseId:'a',name:'Склад А',address:'Адрес Б',coordinates:null},{warehouseId:'b',name:'Склад Б',address:'Адрес Б',coordinates:[48.057,46.371]}]);
  row.warehouse_name='После покупки'; row.warehouse_lon='49';
  assert.equal(result[1].name,'Склад Б'); assert.deepEqual(result[1].coordinates,[48.057,46.371]);
  for (const [lon,lat] of [[null,null],['',46],['NaN',46],['Infinity',46],[181,46],[48,-91],[48,undefined]]) {
    assert.equal(snapshotDeparturePoints([{...row,warehouse_lon:lon,warehouse_lat:lat}])[0].coordinates,null);
  }
});
