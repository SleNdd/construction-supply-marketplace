import { test, expect } from '@playwright/test';
import { loginRole } from './fixtures';
import type { DeparturePoint, Offer, Coordinates } from '../src/lib/api';

test('Настоящий API: выбранная подсказка сохраняет точку и склад, карта строит этот участок',async({page})=>{
  await page.goto('/catalog');await loginRole(page,'buyer');
  const productsResponse=await page.request.get('/api/v1/products?inStock=true&limit=100');expect(productsResponse.ok()).toBe(true);
  const products:Array<{id:string;name:string}>=(await productsResponse.json()).items;
  const detailsResponse=await page.request.get(`/api/v1/products/${products[0].id}`);expect(detailsResponse.ok()).toBe(true);
  const details:{offers:Offer[]} = await detailsResponse.json();const offer=details.offers.find(row=>row.stock>=1)!;expect(offer).toBeTruthy();
  await page.goto(`/product/${products[0].id}`);
  const offerRow=page.locator('.offer-row').filter({hasText:offer.supplierName});
  await offerRow.getByRole('spinbutton',{name:'Количество',exact:true}).fill('1');await offerRow.getByRole('button',{name:'В корзину',exact:true}).click();
  await page.goto('/checkout');
  const suggestionsResponse=await page.request.get('/api/v1/geo/suggest?q='+encodeURIComponent('Савушкина'));expect(suggestionsResponse.ok()).toBe(true);
  const suggestion:( {value:string;coordinates:Coordinates|null})=(await suggestionsResponse.json()).items[0];expect(suggestion.coordinates).toHaveLength(2);
  await page.getByLabel('Адрес объекта или доставки').fill('Савушкина');await page.getByRole('button',{name:suggestion.value,exact:true}).click();
  const confirm=page.getByRole('button',{name:'Подтвердить заказ',exact:true});await expect(confirm).toBeEnabled();
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/orders'&&response.request().method()==='POST');
  const routePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/geo/route');
  let orderId:string|undefined;
  try{
    await confirm.click();const response=await responsePromise;expect(response.ok()).toBe(true);const created=await response.json();orderId=created.id;
    expect(response.request().postDataJSON().destinationCoordinates).toEqual(suggestion.coordinates);
    await expect(page).toHaveURL(`/orders/${orderId}`);
    const savedResponse=await page.request.get(`/api/v1/orders/${orderId}`);expect(savedResponse.ok()).toBe(true);
    const saved:{destinationCoordinates:Coordinates;deliveries:Array<{departurePoints:DeparturePoint[]}>}=await savedResponse.json();
    expect(saved.destinationCoordinates).toEqual(suggestion.coordinates);
    const warehouse=saved.deliveries[0].departurePoints.find(row=>row.warehouseId===offer.warehouseId)!;
    expect(warehouse).toBeTruthy();expect(warehouse.coordinates).toHaveLength(2);expect(warehouse.name).toBeTruthy();expect(warehouse.address).toBeTruthy();
    const routeResponse=await routePromise;expect(routeResponse.ok()).toBe(true);const q=new URL(routeResponse.url()).searchParams;
    expect([Number(q.get('fromLon')),Number(q.get('fromLat'))]).toEqual(warehouse.coordinates);
    expect([Number(q.get('toLon')),Number(q.get('toLat'))]).toEqual(suggestion.coordinates);
    await expect(page.getByTestId('route-geometry')).toBeVisible();
  }finally{
    if(orderId){const cancellation=await page.request.post(`/api/v1/orders/${orderId}/cancel`,{headers:{Origin:new URL(page.url()).origin}});expect(cancellation.ok()).toBe(true);}
  }
});
