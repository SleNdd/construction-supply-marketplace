'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ShoppingBag, Truck } from 'lucide-react';
import { api, type CartItem, type Offer, type Product, type Project, money, quantityUnit } from '@/lib/api';
import { formatCalendarDate } from '@/lib/calendar-date';
import { readCart } from '@/lib/storage';

type Need = NonNullable<Project['items']>[number];
type Quote = { itemsTotalKopecks:number; deliveryTotalKopecks:number; totalKopecks:number; unavailable:Array<{offerId:string;reason:string}>; warnings:string[]; pricingNote:string; zoneAvailable:boolean };

function needKey(item:Need,index:number) { return item.id || `${item.productId}-${index}`; }

function meetsStage(offer:Offer, stageDate?:string|null) {
  if (!stageDate) return true;
  const earliest = new Date();
  earliest.setUTCDate(earliest.getUTCDate()+offer.deliveryDays);
  return earliest.toISOString().slice(0,10) <= stageDate.slice(0,10);
}

export function ProcurementPlan({project,addToCart}:{project:Project;addToCart:(item:CartItem)=>void}) {
  const needs = useMemo(()=>project.items||[],[project.items]);
  const [products,setProducts]=useState<Record<string,Product>>({});
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [quote,setQuote]=useState<Quote|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    if (!needs.length) { setProducts({}); setSelected({}); return; }
    setLoading(true);setError('');
    Promise.all([...new Set(needs.map(item=>item.productId))].map(id=>api<Product>(`/products/${id}`)))
      .then(rows=>{
        if(!active)return;
        const byId=Object.fromEntries(rows.map(row=>[row.id,row]));
        setProducts(byId);
        const initial:Record<string,string>={};
        needs.forEach((need,index)=>{
          const offers=(byId[need.productId]?.offers||[]).filter(offer=>offer.stock>=need.quantity&&meetsStage(offer,need.stageDate));
          offers.sort((a,b)=>(a.priceKopecks*need.quantity+a.deliveryCostKopecks)-(b.priceKopecks*need.quantity+b.deliveryCostKopecks));
          if(offers[0])initial[needKey(need,index)]=offers[0].id;
        });
        setSelected(initial);
      })
      .catch(issue=>{if(active)setError((issue as Error).message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[project.id,needs]);

  const chosen=useMemo(()=>needs.map((need,index)=>{
    const offer=products[need.productId]?.offers?.find(row=>row.id===selected[needKey(need,index)]);
    return offer?{need,offer}:null;
  }).filter((value):value is {need:Need;offer:Offer}=>value!==null),[needs,products,selected]);
  const quoteItems=useMemo(()=>chosen.map(({need,offer})=>({offerId:offer.id,quantity:need.quantity})),[chosen]);
  useEffect(()=>{
    if (!quoteItems.length) { setQuote(null); return; }
    let active=true;
    api<Quote>('/quotes',{method:'POST',body:JSON.stringify({items:quoteItems,address:project.address})})
      .then(value=>{if(active){setQuote(value);setError('');}})
      .catch(issue=>{if(active){setQuote(null);setError((issue as Error).message);}});
    return()=>{active=false;};
  },[quoteItems,project.address]);

  const addPlan=()=>{
    for(const {need,offer} of chosen){
      const product=products[need.productId];
      addToCart({offerId:offer.id,quantity:need.quantity,productId:need.productId,productName:product?.name||need.productName||'Материал',supplierName:offer.supplierName,priceKopecks:offer.priceKopecks,unit:product?.unit||need.unit||'ед.'});
    }
    const items=readCart().map(({offerId,quantity})=>({offerId,quantity})).sort((a,b)=>a.offerId.localeCompare(b.offerId));
    sessionStorage.setItem('objectmarket-project-checkout',JSON.stringify({projectId:project.id,address:project.address,items}));
  };

  return <section className="workspace-panel procurement-plan">
    <div className="panel-heading"><div><span className="overline">ПЛАН ЗАКУПКИ</span><h2>Предложения для объекта</h2></div><Truck size={23}/></div>
    <p className="muted">Предложения предварительно выбираются по цене позиции с доставкой. План учитывает количество и дату этапа, но не резервирует срок. При оформлении проверьте желаемую дату: итоговая доставка пересчитывается по поставщикам.</p>
    {loading?<div className="loading-row">Подбираем предложения…</div>:needs.length?<div className="plan-offers">{needs.map((need,index)=>{
      const product=products[need.productId];
      const available=(product?.offers||[]).filter(offer=>offer.stock>=need.quantity&&meetsStage(offer,need.stageDate));
      const key=needKey(need,index);
      const offer=available.find(value=>value.id===selected[key]);
      return <div className="plan-offer-row" key={key}>
        <div><b>{need.productName||product?.name||need.productId}</b><small>{quantityUnit(need.quantity,need.unit||product?.unit||'ед.')}{need.stageDate?` · к ${formatCalendarDate(need.stageDate)}`:''}</small></div>
        {available.length?<><label>Поставщик и предложение<select value={selected[key]||''} onChange={event=>{setQuote(null);setSelected(current=>({...current,[key]:event.target.value}));}}>{available.map(value=><option value={value.id} key={value.id}>{value.supplierName} · {money(value.priceKopecks)} / {product?.unit||'ед.'} · {value.deliveryDays} дн.</option>)}</select></label><div className="plan-offer-cost"><span>Материалы {money((offer?.priceKopecks||0)*need.quantity)}</span><span>Доставка от {money(offer?.deliveryCostKopecks)}</span></div></>:<div className="plan-unavailable">Нет предложения на нужное количество и дату. <Link href={`/product/${need.productId}`}>Смотреть товар</Link></div>}
      </div>;
    })}</div>:<p className="muted">Добавьте материалы в перечень, чтобы рассчитать закупку.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {quote&&<div className="plan-quote"><div><span>Материалы</span><b>{money(quote.itemsTotalKopecks)}</b></div><div><span>Доставка</span><b>{money(quote.deliveryTotalKopecks)}</b></div><div className="plan-quote-total"><span>Итого</span><b>{money(quote.totalKopecks)}</b></div><small>{quote.pricingNote}</small>{quote.warnings.map((warning,index)=><p className="form-warning" key={index}>{warning}</p>)}</div>}
    {needs.length>0&&<div className="plan-actions"><button className="btn btn-dark" disabled={!quote||chosen.length!==needs.length||!!quote.unavailable.length||!quote.zoneAvailable} onClick={addPlan}><ShoppingBag size={16}/> Добавить план в корзину</button><Link href="/cart" className="text-link">Открыть корзину <ArrowRight size={16}/></Link></div>}
  </section>;
}
