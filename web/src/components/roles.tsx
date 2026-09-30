'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Building2, CalendarDays, Check, ClipboardList, LayoutDashboard, MapPin, Package, Plus, RefreshCw, Truck, UserRound } from 'lucide-react';
import { api, type Category, type Product, type User, money } from '@/lib/api';
import { formatCalendarDate } from '@/lib/calendar-date';
import { AuthRequired, ErrorPanel, PageHeading } from './marketplace';
import { MapPanel } from './route-map';
import { Status } from './orders';
import { useDialogFocus } from '@/lib/use-dialog-focus';

type SupplierOffer={id:string;productId:string;productName:string;warehouseId:string;priceKopecks:number;stock:number;deliveryDays:number;deliveryCostKopecks:number;active:boolean};
type Warehouse={id:string;name:string};
type Driver={id:string;name:string};
type Delivery={id:string;orderId:string;supplierName:string;driverId?:string;driverName?:string;status:string;scheduledDate?:string;address:string;route?:number[][]};
type Summary={orders:{count:number;totalKopecks:string|number};deliveries:Array<{status:string;count:number}>;note:string};
type ProductDraft={name:string;slug:string;categoryId:string;unit:string;imageUrl:string;description:string;specs:string};

export function RoleWorkspace({user,onAuth}:{user:User|null;onAuth:()=>void}) {
  return <div className="container page-section"><PageHeading eyebrow="ЛИЧНЫЙ КАБИНЕТ" title={user?`Здравствуйте, ${user.name.split(' ')[0]}`:'Рабочий кабинет'} description={user?`Роль: ${({buyer:'покупатель',supplier:'поставщик',dispatcher:'диспетчер',driver:'водитель',admin:'администратор'} as Record<string,string>)[user.role]}. Здесь собраны ваши основные действия.`:'Войдите, чтобы увидеть рабочие инструменты.'}/>{!user?<AuthRequired onAuth={onAuth}/>:user.role==='buyer'?<BuyerDashboard/>:user.role==='supplier'?<SupplierDashboard/>:user.role==='dispatcher'?<DispatcherDashboard/>:user.role==='driver'?<DriverDashboard/>:<AdminDashboard/>}</div>;
}

function BuyerDashboard(){return <div className="dashboard-grid"><Link href="/catalog" className="dashboard-card"><span>01 / МАТЕРИАЛЫ</span><Package size={29}/><h2>Каталог</h2><p>Найдите товары, сравните поставщиков и условия доставки.</p><strong>Открыть каталог <ArrowRight size={17}/></strong></Link><Link href="/projects" className="dashboard-card"><span>02 / ОБЪЕКТЫ</span><Building2 size={29}/><h2>Мои объекты</h2><p>Планируйте потребность и рассчитывайте количество материалов.</p><strong>Открыть объекты <ArrowRight size={17}/></strong></Link><Link href="/orders" className="dashboard-card"><span>03 / ПОСТАВКИ</span><Truck size={29}/><h2>Заказы</h2><p>Проверяйте статусы и подтверждайте учебную оплату.</p><strong>Мои заказы <ArrowRight size={17}/></strong></Link></div>}

function SupplierDashboard(){const[offers,setOffers]=useState<SupplierOffer[]>([]);const[warehouses,setWarehouses]=useState<Warehouse[]>([]);const[products,setProducts]=useState<Product[]>([]);const[error,setError]=useState('');const[loading,setLoading]=useState(true);const[busy,setBusy]=useState<string|null>(null);const[editing,setEditing]=useState<string|null>(null);const[draft,setDraft]=useState<Partial<SupplierOffer>>({});const[creating,setCreating]=useState(false);
  const load=useCallback(()=>{setLoading(true);Promise.all([api<SupplierOffer[]>('/supplier/offers'),api<Warehouse[]>('/supplier/warehouses'),api<{items:Product[]}>('/products?limit=100')]).then(([offerRows,warehouseRows,productRows])=>{setOffers(offerRows);setWarehouses(warehouseRows);setProducts(productRows.items);}).catch(issue=>setError(issue.message)).finally(()=>setLoading(false));},[]);useEffect(load,[load]);
  const save=async(offer?:SupplierOffer)=>{const id=offer?.id||'new';setBusy(id);setError('');try{const body={priceKopecks:Math.round(Number(draft.priceKopecks||0)),stock:Number(draft.stock||0),deliveryDays:Number(draft.deliveryDays||0),deliveryCostKopecks:Math.round(Number(draft.deliveryCostKopecks||0)),...(offer?{active:draft.active??offer.active}:{productId:draft.productId,warehouseId:draft.warehouseId})};await api(offer?`/supplier/offers/${offer.id}`:'/supplier/offers',{method:offer?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setEditing(null);setCreating(false);setDraft({});load();}catch(issue){setError((issue as Error).message);}finally{setBusy(null);}};
  return <div className="workspace-panel"><div className="panel-heading"><div><span className="overline">ПОСТАВЩИК / АССОРТИМЕНТ</span><h2>Мои предложения</h2></div><button className="btn btn-dark" onClick={()=>{setCreating(true);setDraft({warehouseId:offers[0]?.warehouseId,stock:0,deliveryDays:2,deliveryCostKopecks:0});}}><Plus size={16}/> Предложение</button></div><p className="muted">Изменение цены или остатка не влияет на уже оформленные заказы.</p>{error&&<p className="form-error">{error}</p>}{creating&&<div className="offer-edit"><label>Товар<select value={draft.productId||''} onChange={event=>setDraft({...draft,productId:event.target.value})}><option value=''>Выберите товар</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Склад<select value={draft.warehouseId||''} onChange={event=>setDraft({...draft,warehouseId:event.target.value})}><option value=''>Выберите склад</option>{warehouses.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><OfferFields draft={draft} setDraft={setDraft}/><button className="btn btn-dark" disabled={busy==='new'} onClick={()=>save()}>Создать <Check size={16}/></button><button className="btn btn-outline" onClick={()=>setCreating(false)}>Отмена</button></div>}{loading?<div className="loading-row">Загружаем предложения…</div>:offers.length?<div className="supplier-list">{offers.map(offer=><div className="supplier-offer" key={offer.id}><div className="supplier-offer-main"><span className="supplier-avatar"><Package size={19}/></span><div><b>{offer.productName}</b><small>{warehouses.find(warehouse=>warehouse.id===offer.warehouseId)?.name||'Склад'} · {offer.active?'Активно':'Скрыто'}</small></div></div>{editing===offer.id?<div className="offer-edit"><OfferFields draft={draft} setDraft={setDraft}/><label className="check-label"><input type="checkbox" checked={draft.active??offer.active} onChange={event=>setDraft({...draft,active:event.target.checked})}/> Активно</label><button className="btn btn-dark" disabled={busy===offer.id} onClick={()=>save(offer)}>Сохранить</button><button className="btn btn-outline" onClick={()=>setEditing(null)}>Отмена</button></div>:<><span><small>Цена</small><b>{money(offer.priceKopecks)}</b></span><span><small>Остаток</small><b>{offer.stock}</b></span><span><small>Срок</small><b>{offer.deliveryDays} дн.</b></span><button className="btn btn-outline" onClick={()=>{setEditing(offer.id);setDraft({...offer});}}>Изменить</button></>}</div>)}</div>:<div className="empty-state">Предложений пока нет.</div>}</div>;
}
function OfferFields({draft,setDraft}:{draft:Partial<SupplierOffer>;setDraft:(value:Partial<SupplierOffer>)=>void}){return <div className="offer-fields"><label>Цена, ₽<input type="number" min="0.01" step="0.01" value={draft.priceKopecks==null?'':draft.priceKopecks/100} onChange={event=>setDraft({...draft,priceKopecks:Math.round(Number(event.target.value)*100)})}/></label><label>Остаток<input type="number" min="0" step="1" value={draft.stock??''} onChange={event=>setDraft({...draft,stock:Number(event.target.value)})}/></label><label>Срок, дней<input type="number" min="0" step="1" value={draft.deliveryDays??''} onChange={event=>setDraft({...draft,deliveryDays:Number(event.target.value)})}/></label><label>Доставка, ₽<input type="number" min="0" step="0.01" value={draft.deliveryCostKopecks==null?'':draft.deliveryCostKopecks/100} onChange={event=>setDraft({...draft,deliveryCostKopecks:Math.round(Number(event.target.value)*100)})}/></label></div>}

function DispatcherDashboard(){const[deliveries,setDeliveries]=useState<Delivery[]>([]);const[drivers,setDrivers]=useState<Driver[]>([]);const[error,setError]=useState('');const[loading,setLoading]=useState(true);const[driverIds,setDriverIds]=useState<Record<string,string>>({});const[dates,setDates]=useState<Record<string,string>>({});const[busy,setBusy]=useState<string|null>(null);
  const load=useCallback(()=>{setLoading(true);Promise.all([api<Delivery[]>('/dispatch/deliveries'),api<Driver[]>('/dispatch/drivers')]).then(([rows,people])=>{setDeliveries(rows);setDrivers(people);}).catch(issue=>setError(issue.message)).finally(()=>setLoading(false));},[]);useEffect(load,[load]);
  const assign=async(delivery:Delivery)=>{setBusy(delivery.id);setError('');try{await api(`/dispatch/deliveries/${delivery.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({driverId:driverIds[delivery.id]||delivery.driverId,scheduledDate:dates[delivery.id]||delivery.scheduledDate})});load();}catch(issue){setError((issue as Error).message);}finally{setBusy(null);}};
  return <div className="workspace-panel"><div className="panel-heading"><div><span className="overline">ДИСПЕТЧЕР / ЛОГИСТИКА</span><h2>План поставок</h2></div><Truck size={24}/></div><p className="muted">Назначьте водителя и дату после учебного подтверждения оплаты. Выберите водителя из списка.</p>{error&&<p className="form-error">{error}</p>}{loading?<div className="loading-row">Загружаем поставки…</div>:deliveries.length?<div className="delivery-list">{deliveries.map(delivery=><div className="delivery-card" key={delivery.id}><div className="delivery-card-head"><div><span className="overline">ПОСТАВКА #{delivery.id.slice(0,8).toUpperCase()}</span><h3>{delivery.supplierName}</h3><p><MapPin size={15}/>{delivery.address}</p></div><Status status={delivery.status}/></div><div className="delivery-card-meta"><span>Заказ #{delivery.orderId.slice(0,8)}</span><span>{delivery.scheduledDate?formatCalendarDate(delivery.scheduledDate):'Дата не назначена'}</span><span>{delivery.driverName||'Водитель не назначен'}</span></div>{['pending','assigned'].includes(delivery.status)&&<div className="dispatch-controls"><label>Водитель<select value={driverIds[delivery.id]??delivery.driverId??''} onChange={event=>setDriverIds({...driverIds,[delivery.id]:event.target.value})}><option value=''>Выберите водителя</option>{drivers.map(driver=><option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><label>Дата рейса<input type="date" value={dates[delivery.id]??delivery.scheduledDate?.slice(0,10)??''} onChange={event=>setDates({...dates,[delivery.id]:event.target.value})}/></label><button className="btn btn-dark" disabled={busy===delivery.id} onClick={()=>assign(delivery)}>Назначить <ArrowRight size={16}/></button></div>}</div>)}</div>:<div className="empty-state">Поставок пока нет.</div>}</div>;
}

function DriverDashboard(){const[deliveries,setDeliveries]=useState<Delivery[]>([]);const[error,setError]=useState('');const[loading,setLoading]=useState(true);const[busy,setBusy]=useState<string|null>(null);
  const load=useCallback(()=>{setLoading(true);api<Delivery[]>('/driver/deliveries').then(setDeliveries).catch(issue=>setError(issue.message)).finally(()=>setLoading(false));},[]);useEffect(load,[load]);
  const next:Record<string,{status:string;label:string}>={assigned:{status:'picked_up',label:'Материалы загружены'},picked_up:{status:'in_transit',label:'Начать рейс'},in_transit:{status:'delivered',label:'Доставка завершена'}};
  const advance=async(delivery:Delivery)=>{setBusy(delivery.id);setError('');try{await api(`/driver/deliveries/${delivery.id}/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:next[delivery.status].status})});load();}catch(issue){setError((issue as Error).message);}finally{setBusy(null);}};
  return <div className="driver-layout"><div className="workspace-panel"><div className="panel-heading"><div><span className="overline">ВОДИТЕЛЬ / МОИ РЕЙСЫ</span><h2>Поставки</h2></div><Truck size={24}/></div><p className="muted">Статусы изменяются вручную. Координаты и реальное движение автомобиля не отслеживаются.</p>{error&&<p className="form-error">{error}</p>}{loading?<div className="loading-row">Загружаем рейсы…</div>:deliveries.length?<div className="delivery-list">{deliveries.map(delivery=><div className="delivery-card" key={delivery.id}><div className="delivery-card-head"><div><span className="overline">РЕЙС #{delivery.id.slice(0,8).toUpperCase()}</span><h3>{delivery.supplierName}</h3><p><MapPin size={15}/>{delivery.address}</p></div><Status status={delivery.status}/></div><div className="delivery-card-meta"><span><CalendarDays size={15}/>{delivery.scheduledDate?formatCalendarDate(delivery.scheduledDate):'Дата уточняется'}</span><span>Заказ #{delivery.orderId.slice(0,8)}</span></div>{next[delivery.status]&&<button className="btn btn-dark" disabled={busy===delivery.id} onClick={()=>advance(delivery)}>{next[delivery.status].label} <ArrowRight size={16}/></button>}</div>)}</div>:<div className="empty-state">Назначенных рейсов пока нет.</div>}</div><MapPanel compact/></div>;
}

function AdminDashboard() {
  const [summary,setSummary]=useState<Summary|null>(null);
  const [categories,setCategories]=useState<Category[]>([]);
  const [products,setProducts]=useState<Product[]>([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [query,setQuery]=useState('');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [categoryEdit,setCategoryEdit]=useState<Category|null|undefined>(undefined);
  const [categoryDraft,setCategoryDraft]=useState({name:'',slug:''});
  const [productEdit,setProductEdit]=useState<Product|null|undefined>(undefined);
  const [productDraft,setProductDraft]=useState<ProductDraft>({name:'',slug:'',categoryId:'',unit:'',imageUrl:'',description:'',specs:'{}'});
  const [busy,setBusy]=useState(false);
  const categoryDialogRef=useDialogFocus(categoryEdit!==undefined,()=>setCategoryEdit(undefined));
  const productDialogRef=useDialogFocus(productEdit!==undefined,()=>setProductEdit(undefined));
  const limit=12;

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    try {
      const [report,categoryRows,productPage]=await Promise.all([
        api<Summary>('/reports/summary'),
        api<Category[]>('/categories'),
        api<{items:Product[];total:number}>(`/products?limit=${limit}&page=${page}&q=${encodeURIComponent(search)}`)
      ]);
      setSummary(report);
      setCategories(categoryRows);
      setProducts(productPage.items);
      setTotal(productPage.total);
    } catch(issue) {
      setError((issue as Error).message);
    } finally {
      setLoading(false);
    }
  },[page,search]);
  useEffect(()=>{void load();},[load]);

  const saveCategory=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const name=categoryDraft.name.trim();
    const slug=categoryDraft.slug.trim();
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError('Укажите название и адрес категории латиницей, цифрами и дефисами.');
      return;
    }
    setBusy(true);setError('');setNotice('');
    try {
      await api(categoryEdit ? `/admin/categories/${categoryEdit.id}` : '/admin/categories',{
        method:categoryEdit?'PATCH':'POST',body:JSON.stringify({name,slug})
      });
      setCategoryEdit(undefined);
      setNotice(categoryEdit?'Категория обновлена.':'Категория добавлена.');
      await load();
    } catch(issue) {setError((issue as Error).message);}
    finally {setBusy(false);}
  };

  const saveProduct=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const name=productDraft.name.trim();
    const slug=productDraft.slug.trim();
    const unit=productDraft.unit.trim();
    const imageUrl=productDraft.imageUrl.trim();
    if (!name || !unit || !productDraft.categoryId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError('Заполните название, категорию, единицу измерения и адрес товара латиницей.');
      return;
    }
    if (imageUrl && !imageUrl.startsWith('https://') && !imageUrl.startsWith('/images/')) {
      setError('Для изображения укажите HTTPS адрес или путь /images/.');
      return;
    }
    let specs:Record<string,unknown>;
    try {
      const parsed:unknown=JSON.parse(productDraft.specs||'{}');
      if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error();
      specs=parsed as Record<string,unknown>;
    } catch {
      setError('Характеристики должны быть объектом JSON, например {"прочность":"М150"}.');
      return;
    }
    setBusy(true);setError('');setNotice('');
    try {
      await api(productEdit ? `/admin/products/${productEdit.id}` : '/admin/products',{
        method:productEdit?'PATCH':'POST',
        body:JSON.stringify({name,slug,unit,categoryId:productDraft.categoryId,imageUrl:imageUrl||null,description:productDraft.description.trim(),specs})
      });
      setProductEdit(undefined);
      setNotice(productEdit?'Товар обновлён.':'Товар добавлен.');
      await load();
    } catch(issue) {setError((issue as Error).message);}
    finally {setBusy(false);}
  };

  const openCategory=(category:Category|null)=>{
    setProductEdit(undefined);setError('');setNotice('');
    setCategoryEdit(category);
    setCategoryDraft(category?{name:category.name,slug:category.slug}:{name:'',slug:''});
  };
  const openProduct=(product:Product|null)=>{
    setCategoryEdit(undefined);setError('');setNotice('');
    setProductEdit(product);
    const categoryName=product?typeof product.category==='string'?product.category:product.category.name:'';
    setProductDraft({
      name:product?.name||'',slug:product?.slug||'',
      categoryId:product?.categoryId||categories.find(category=>category.name===categoryName)?.id||categories[0]?.id||'',
      unit:product?.unit||'',imageUrl:product?.imageUrl||'',
      description:product?.description||'',specs:JSON.stringify(product?.specs||{},null,2)
    });
  };

  return <div className="admin-dashboard">
    <div className="workspace-panel">
      <div className="panel-heading"><div><span className="overline">АДМИНИСТРАТОР / ОБЗОР</span><h2>Сводка системы</h2></div><button className="btn btn-outline" onClick={()=>void load()}><RefreshCw size={15}/> Обновить</button></div>
      {error&&<ErrorPanel message={error} onRetry={load}/>}
      {notice&&<p className="form-info" role="status">{notice}</p>}
      {loading?<div className="loading-row">Загружаем данные…</div>:summary&&<><div className="report-stats"><div><span>Учебных заказов</span><b>{summary.orders.count}</b><small>Во всей системе</small></div><div><span>Сумма заказов</span><b>{money(Number(summary.orders.totalKopecks))}</b><small>Без реальных списаний</small></div><div><span>Поставок</span><b>{summary.deliveries.reduce((sum,item)=>sum+item.count,0)}</b><small>По всем статусам</small></div></div><h3>Статусы поставок</h3><div className="report-statuses">{summary.deliveries.map(item=><div key={item.status}><Status status={item.status}/><b>{item.count}</b></div>)}</div><p className="form-info">{summary.note}</p></>}
    </div>
    <div className="workspace-panel admin-section">
      <div className="panel-heading"><div><span className="overline">СПРАВОЧНИК</span><h2>Категории</h2></div><button className="btn btn-dark" onClick={()=>openCategory(null)}><Plus size={16}/> Категория</button></div>
      <div className="admin-category-list">{categories.map(category=><div className="admin-category-row" key={category.id}><div><b>{category.name}</b><small>/catalog?category={category.slug}</small></div><button className="btn btn-outline" onClick={()=>openCategory(category)}>Изменить</button></div>)}</div>
    </div>
    <div className="workspace-panel admin-section">
      <div className="panel-heading"><div><span className="overline">СПРАВОЧНИК</span><h2>Товары <small>({total})</small></h2></div><button className="btn btn-dark" onClick={()=>openProduct(null)}><Plus size={16}/> Товар</button></div>
      <form className="admin-search" onSubmit={event=>{event.preventDefault();setPage(1);setSearch(query.trim());}}><label htmlFor="admin-product-search">Поиск по названию или описанию</label><div><input id="admin-product-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Например, кирпич"/><button className="btn btn-outline" type="submit">Найти</button></div></form>
      {products.length?<div className="admin-product-list">{products.map(product=><div className="admin-product-row" key={product.id}><div><b>{product.name}</b><small>{typeof product.category==='string'?product.category:product.category.name} · {product.unit} · {product.priceFromKopecks?money(product.priceFromKopecks):'Без предложений'}</small></div><button className="btn btn-outline" onClick={()=>openProduct(product)}>Изменить</button></div>)}</div>:!loading&&<div className="empty-state">Товары не найдены.</div>}
      {total>limit&&<div className="admin-pagination"><button className="btn btn-outline" disabled={page===1||loading} onClick={()=>setPage(page-1)}>Назад</button><span>Страница {page} из {Math.ceil(total/limit)}</span><button className="btn btn-outline" disabled={page>=Math.ceil(total/limit)||loading} onClick={()=>setPage(page+1)}>Далее</button></div>}
    </div>
    {categoryEdit!==undefined&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setCategoryEdit(undefined);}}><div ref={categoryDialogRef} tabIndex={-1} className="auth-modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="admin-category-title"><button className="icon-button modal-close" aria-label="Закрыть" onClick={()=>setCategoryEdit(undefined)}>×</button><span className="overline">СПРАВОЧНИК</span><h2 id="admin-category-title">{categoryEdit?'Изменить категорию':'Новая категория'}</h2><form className="form-stack" onSubmit={saveCategory}><label>Название<input required maxLength={100} value={categoryDraft.name} onChange={event=>setCategoryDraft({...categoryDraft,name:event.target.value})}/></label><label>Адрес категории<input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={categoryDraft.slug} onChange={event=>setCategoryDraft({...categoryDraft,slug:event.target.value})} placeholder="suhie-smesi"/></label><p className="form-info">Латинские буквы, цифры и дефисы. Этот адрес используется в каталоге.</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="btn btn-dark" disabled={busy} type="submit">{busy?'Сохраняем…':'Сохранить'}</button></form></div></div>}
    {productEdit!==undefined&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setProductEdit(undefined);}}><div ref={productDialogRef} tabIndex={-1} className="auth-modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="admin-product-title"><button className="icon-button modal-close" aria-label="Закрыть" onClick={()=>setProductEdit(undefined)}>×</button><span className="overline">КАТАЛОГ</span><h2 id="admin-product-title">{productEdit?'Изменить товар':'Новый товар'}</h2><form className="form-stack admin-product-form" onSubmit={saveProduct}><label>Название<input required maxLength={200} value={productDraft.name} onChange={event=>setProductDraft({...productDraft,name:event.target.value})}/></label><div className="admin-form-grid"><label>Категория<select required value={productDraft.categoryId} onChange={event=>setProductDraft({...productDraft,categoryId:event.target.value})}><option value="">Выберите категорию</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Единица измерения<input required maxLength={30} value={productDraft.unit} onChange={event=>setProductDraft({...productDraft,unit:event.target.value})} placeholder="мешок"/></label></div><label>Адрес товара<input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={productDraft.slug} onChange={event=>setProductDraft({...productDraft,slug:event.target.value})} placeholder="cement-m500"/></label><label>Описание<textarea maxLength={2000} rows={3} value={productDraft.description} onChange={event=>setProductDraft({...productDraft,description:event.target.value})}/></label><label>Изображение (необязательно)<input value={productDraft.imageUrl} onChange={event=>setProductDraft({...productDraft,imageUrl:event.target.value})} placeholder="https://... или /images/..."/></label><label>Характеристики, JSON<textarea rows={4} value={productDraft.specs} onChange={event=>setProductDraft({...productDraft,specs:event.target.value})} spellCheck={false}/></label><p className="form-info">Пример: { '{"марка":"М500","вес":50}' }. Если характеристик нет, оставьте пустой объект {}.</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="btn btn-dark" disabled={busy} type="submit">{busy?'Сохраняем…':'Сохранить товар'}</button></form></div></div>}
  </div>;
}
