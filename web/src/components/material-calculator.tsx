'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Calculator, Check, Package } from 'lucide-react';
import { api, quantityUnit, type Product, type ProductPackaging, type Project } from '@/lib/api';
import { formatMeasure, packagingLabel, supportsCalculation } from '@/lib/packaging';
import styles from './material-calculator.module.css';

type Kind = ProductPackaging['kind'];
type Item = NonNullable<Project['items']>[number];
type Calculation = { productId: string; unit: string; packaging: ProductPackaging; formula: string; calculatedConsumption: number; consumptionUnit: string; packages: number; coverage: number; coverageUnit: string };
const labels: Record<Kind, string> = { tiles: 'Плитка', paint: 'Краска', 'dry-mix': 'Сухая смесь' };
const fields: Record<Kind, { key: string; label: string; initial: number; unit: string }[]> = {
  tiles: [{ key: 'areaM2', label: 'Площадь облицовки', initial: 24, unit: 'м²' }, { key: 'wastePercent', label: 'Запас на подрезку', initial: 10, unit: '%' }],
  paint: [{ key: 'areaM2', label: 'Площадь окрашивания', initial: 60, unit: 'м²' }, { key: 'rateLPerM2', label: 'Расход на один слой', initial: .12, unit: 'л/м²' }, { key: 'coats', label: 'Количество слоёв', initial: 2, unit: 'сл.' }, { key: 'wastePercent', label: 'Запас', initial: 5, unit: '%' }],
  'dry-mix': [{ key: 'areaM2', label: 'Площадь работ', initial: 40, unit: 'м²' }, { key: 'rateKgPerM2Mm', label: 'Расход на 1 мм слоя', initial: 1.5, unit: 'кг/м²·мм' }, { key: 'layerMm', label: 'Толщина слоя', initial: 10, unit: 'мм' }, { key: 'wastePercent', label: 'Запас', initial: 10, unit: '%' }],
};

export function MaterialCalculator({ projectId, onAdded }: { projectId: string; onAdded: (item: Item) => void }) {
  const [kind, setKind] = useState<Kind>('tiles');
  const [values, setValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [result, setResult] = useState<Calculation | null>(null);
  const [error, setError] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [stageDate, setStageDate] = useState('');
  const request = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  const previewVersion = useRef(0);
  const currentFields = fields[kind];
  const inputs = Object.fromEntries(currentFields.map(field => [field.key, Number(values[field.key] ?? field.initial)]));

  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setCatalogError('');
      api<{ items: Product[] }>(`/products?q=${encodeURIComponent(search)}&limit=100`, { signal: abort.signal })
        .then(data => { if (!abort.signal.aborted) setCatalog(data.items); })
        .catch(issue => { if (!abort.signal.aborted) setCatalogError(issue.message); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [search, catalogAttempt]);
  useEffect(() => () => request.current?.abort(), []);

  function resetResult() {
    previewVersion.current++; request.current?.abort();
    setResult(null); setError(''); setCalculating(false); setAdded(false);
  }

  function startNewCalculation() {
    keys.current.delete(JSON.stringify({ productId: product?.id, kind, inputs, stageDate: stageDate || null }));
    resetResult();
  }

  async function calculate(event: React.FormEvent) {
    event.preventDefault();
    if (!product || !supportsCalculation(product, kind)) return;
    resetResult();
    const version = previewVersion.current;
    const abort = new AbortController(); request.current = abort;
    setCalculating(true);
    try {
      const calculation = await api<Calculation>('/calculators/material', { method: 'POST', body: JSON.stringify({ productId: product.id, kind, inputs }), signal: abort.signal });
      if (version === previewVersion.current && !abort.signal.aborted) setResult(calculation);
    } catch (issue) {
      if (version === previewVersion.current && !abort.signal.aborted) setError((issue as Error).message);
    } finally {
      if (version === previewVersion.current) setCalculating(false);
    }
  }

  async function add() {
    if (!product || !result || adding || added) return;
    const body = { productId: product.id, kind, inputs, stageDate: stageDate || null };
    const signature = JSON.stringify(body);
    // После сетевой ошибки повторяем прежнее намерение с тем же ключом.
    const key = keys.current.get(signature) || crypto.randomUUID();
    keys.current.set(signature, key);
    setAdding(true); setError('');
    try {
      const response = await api<{ item: Item; calculation: Calculation }>(`/projects/${projectId}/items/from-calculation`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
      keys.current.delete(signature);
      setResult(response.calculation); setAdded(true); onAdded(response.item);
    } catch (issue) { setError((issue as Error).message); }
    finally { setAdding(false); }
  }

  return <section className="workspace-panel" aria-labelledby="material-calculator-title">
    <div className="panel-heading"><div><span className="overline">ОТ ПЛОЩАДИ К ЗАКУПКЕ</span><h2 id="material-calculator-title">Калькулятор материалов</h2></div><Calculator size={23}/></div>
    <p className={styles.intro}>Выберите материал, укажите объём работ и запас. Фасовка берётся из карточки товара, количество округляется вверх.</p>
    <div className={styles.tabs} aria-label="Вид расчёта">{(Object.keys(labels) as Kind[]).map(value => <button key={value} type="button" aria-pressed={kind === value} disabled={adding} onClick={() => { resetResult(); setKind(value); setValues({}); setProduct(null); }}>{labels[value]}</button>)}</div>
    <form className={styles.form} onSubmit={calculate}>
      <div className={styles.field}><label htmlFor="calculation-search">Поиск материала</label><input id="calculation-search" placeholder="Название товара" value={search} disabled={adding} onChange={event => setSearch(event.target.value)}/></div>
      <div className={styles.field}><label htmlFor="calculation-product">Материал</label><select id="calculation-product" value={product?.id || ''} required disabled={adding} onChange={event => { resetResult(); setProduct(catalog.find(item => item.id === event.target.value) || null); }}>
        <option value="">{loading ? 'Загружаем товары…' : 'Выберите товар и фасовку'}</option>
        {product && !catalog.some(item => item.id === product.id) && <option value={product.id}>{product.name} · {product.unit}</option>}
        {catalog.map(item => <option key={item.id} value={item.id} disabled={!supportsCalculation(item, kind)}>{item.name} · {item.unit}{supportsCalculation(item, kind) ? '' : ' — расчёт недоступен'}</option>)}
      </select></div>
      {catalogError && <div role="alert"><p className="form-error">{catalogError}</p><button className="btn btn-outline" type="button" onClick={() => setCatalogAttempt(value => value + 1)}>Повторить загрузку</button></div>}
      {!loading && !catalogError && !catalog.some(item => supportsCalculation(item, kind)) && <p className={styles.help}>В этой выборке нет товаров с подходящей фасовкой. Измените поиск. Для автоматического расчёта нужна коробка плитки, ведро краски или мешок смеси с указанным размером упаковки.</p>}
      {product?.packaging && <div className={styles.packaging}><Package size={22}/><div><b>{packagingLabel(product.packaging)}</b><small>Цена и остаток указаны за {product.unit === 'коробка' ? 'коробку' : product.unit === 'ведро' ? 'ведро' : 'мешок'}.</small></div></div>}
      <div className={styles.fields}>{currentFields.map(field => <div key={field.key} className={styles.field}><label htmlFor={`calculation-${field.key}`}>{field.label}</label><span className={styles.input}><input id={`calculation-${field.key}`} aria-describedby={`calculation-unit-${field.key}`} type="number" required min={field.key === 'wastePercent' ? 0 : field.key === 'coats' ? 1 : .000001} max={1e9} step={field.key === 'coats' ? 1 : 'any'} value={values[field.key] ?? field.initial} disabled={adding} onChange={event => { resetResult(); setValues(current => ({ ...current, [field.key]: event.target.value })); }}/><small id={`calculation-unit-${field.key}`}>{field.unit}</small></span></div>)}</div>
      {kind !== 'tiles' && <p className={styles.help}>Норму расхода укажите по инструкции к материалу и условиям работ. Калькулятор не определяет свойства основания.</p>}
      <p className={styles.help}>До 1 млн упаковок в расчёте; исходные значения и расход — до 1 млрд. Одна закупка ограничена 10 000 единицами предложения.</p>
      <div><button className="btn btn-dark" disabled={!product || calculating || adding}>{calculating ? 'Считаем…' : 'Рассчитать'} <ArrowRight size={16}/></button></div>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className={styles.result} role="region" aria-label="Результат расчёта" aria-live="polite">
      <span className="overline">С УЧЁТОМ ЗАПАСА</span><div className={styles.total}>{quantityUnit(result.packages, result.unit)}</div>
      <p className={styles.coverage}>{kind === 'tiles' ? 'Покрытие' : 'В упаковках'}: {formatMeasure(result.coverage)} {result.coverageUnit}</p>
      <div className={styles.formula}>{result.formula}<br/>Расчётный расход: {formatMeasure(result.calculatedConsumption)} {result.consumptionUnit}. Округление — до целой упаковки.</div>
      {added ? <div className={styles.actions}><p className={styles.success}><Check size={20}/> Материал добавлен в перечень объекта</p><button className="btn btn-outline" type="button" onClick={resetResult}>Новый расчёт</button></div> : <>
        <div className={styles.field} style={{ marginTop: 18 }}><label htmlFor="calculation-stage">К этапу</label><input id="calculation-stage" type="date" value={stageDate} disabled={adding} onChange={event => { setStageDate(event.target.value); setError(''); }}/></div>
        <div className={styles.actions}><button className="btn btn-dark" type="button" disabled={adding} onClick={add}>{adding ? 'Добавляем…' : 'Добавить расчёт в объект'} <ArrowRight size={16}/></button>{error && <button className="btn btn-outline" type="button" disabled={adding} onClick={startNewCalculation}>Новый расчёт</button>}</div>
        {error && <p className={styles.help}>Если ответ потерялся, повторите добавление. Новый расчёт начнёт отдельную позицию.</p>}
      </>}
    </div>}
  </section>;
}
