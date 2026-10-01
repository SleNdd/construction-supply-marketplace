'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { api, quantityUnit, type Product } from '@/lib/api';
import { importTemplate, parseCsv, parseImportRows, type ImportRow } from '@/lib/project-import';
import styles from './project-import.module.css';

async function catalog(signal: AbortSignal): Promise<Product[]> {
  const products: Product[] = [];
  for (let page = 1; ; page++) {
    const result = await api<{ items: Product[]; total: number }>(`/products?limit=100&page=${page}`, { signal });
    if (!Number.isSafeInteger(result.total) || result.total < 0) throw new Error('Не удалось проверить полноту каталога.');
    products.push(...result.items);
    if (products.length >= result.total) return products;
    if (!result.items.length) throw new Error('Каталог получен не полностью. Повторите проверку.');
  }
}

export function ProjectImport({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'reading' | 'checking' | 'sending'>('idle');
  const [lookupFailed, setLookupFailed] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const templateRequest = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); templateRequest.current?.abort(); }; }, []);

  const verify = async (parsed: ImportRow[], controller: AbortController) => {
    setPhase('checking'); setStatus('Проверяем товары по каталогу…');
    try {
      const products = await catalog(controller.signal);
      if (controller.signal.aborted) return;
      const byId = new Map(products.map(product => [product.id.toLowerCase(), product]));
      setRows(parsed.map(row => ({ ...row, product: byId.get(row.productId), error: row.error || (!byId.has(row.productId) ? 'Товар с таким ID отсутствует в каталоге' : undefined) })));
      setStatus('Проверка завершена. Проверьте строки перед добавлением.'); setLookupFailed(false);
    } catch {
      if (controller.signal.aborted) return;
      setError('Не удалось проверить каталог. Товары пока не проверены; добавление недоступно.'); setLookupFailed(true);
    } finally { if (!controller.signal.aborted) setPhase('idle'); }
  };

  const read = async (file: File) => {
    if (sending.current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setRows([]); setError(''); setLookupFailed(false); setPhase('reading'); setStatus(`Читаем ${file.name}…`);
    try {
      if (file.size > 1024 * 1024) throw new Error('Файл должен быть не больше 1 МБ.');
      let cells: unknown[][];
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        try { const { default: readXlsxFile } = await import('read-excel-file'); cells = await readXlsxFile(file); }
        catch { throw new Error('Не удалось прочитать XLSX. Проверьте формат файла.'); }
      } else if (file.name.toLowerCase().endsWith('.csv')) cells = parseCsv(await file.text());
      else throw new Error('Поддерживаются CSV и XLSX.');
      if (controller.signal.aborted) return;
      const parsed = parseImportRows(cells); setRows(parsed);
      await verify(parsed, controller);
    } catch (issue) {
      if (!controller.signal.aborted) { setError((issue as Error).message || 'Не удалось прочитать файл.'); setStatus('Чтение не завершено.'); setPhase('idle'); }
    }
  };

  const download = async () => {
    if (templateBusy || sending.current) return;
    setTemplateBusy(true); setError('');
    const controller = new AbortController(); templateRequest.current = controller;
    try {
      const products = await catalog(controller.signal);
      if (controller.signal.aborted) return;
      if (!products.length) throw new Error('В каталоге пока нет товаров для примера.');
      const url = URL.createObjectURL(new Blob([importTemplate(products[0])], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'vedomost-obekta.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (issue) { if (!controller.signal.aborted) setError(`Шаблон не загружен. ${(issue as Error).message}`); }
    finally { if (!controller.signal.aborted) setTemplateBusy(false); }
  };

  const submit = async (retry = false) => {
    if (sending.current || phase !== 'idle' || lookupFailed) return;
    const pending = rows.filter(row => !row.error && !row.imported && Boolean(row.sendError) === retry);
    if (!pending.length) return;
    sending.current = true; setPhase('sending'); setError('');
    const updated = rows.map(row => ({ ...row })); let success = 0;
    for (const row of updated) {
      if (!mounted.current) break;
      if (row.error || row.imported || Boolean(row.sendError) !== retry) continue;
      try {
        await api(`/projects/${projectId}/items`, { method: 'POST', body: JSON.stringify({ productId: row.productId, quantity: row.quantity, stageDate: row.stageDate }) });
        row.imported = true; row.sendError = undefined; success++;
      } catch (issue) { row.sendError = (issue as Error).message; }
      if (mounted.current) { setRows(updated.map(value => ({ ...value }))); setStatus(`Добавлено ${success} из ${pending.length} отправляемых строк.`); }
    }
    sending.current = false;
    if (mounted.current) { setPhase('idle'); if (success) onAdded(); }
  };

  const ready = rows.filter(row => !row.error && !row.sendError && !row.imported).length;
  const failures = rows.filter(row => row.error || row.sendError).length;
  const imported = rows.filter(row => row.imported).length;
  const locked = phase !== 'idle' || lookupFailed;
  return <section className={`workspace-panel ${styles.panel}`} aria-label="Импорт ведомости">
    <div className="panel-heading"><div><span className="overline">ВЕДОМОСТЬ</span><h2>Импорт списка</h2></div><FileSpreadsheet size={22}/></div>
    <p className="muted">CSV или XLSX до 1 МБ, максимум 200 строк материалов. Заголовок: ID товара, Количество, Дата этапа. Английские productId, quantity, stageDate также поддерживаются. Количество — положительное целое число.</p>
    <p className={styles.help}>Шаблон содержит одну примерную строку с реальным товаром из каталога. Измените количество и дату или добавьте строки. Название и единица — подсказки; товар определяется только по ID. Дата необязательна, формат ГГГГ-ММ-ДД.</p>
    <div className={styles.actions}><button className="btn btn-outline" onClick={download} disabled={templateBusy || phase === 'sending'}><Download size={17}/>{templateBusy ? 'Готовим шаблон…' : 'Скачать CSV-шаблон'}</button></div>
    <label className={styles.file}>Выбрать файл CSV / XLSX<input type="file" accept=".csv,.xlsx" disabled={phase === 'sending'} onChange={event => { const file = event.target.files?.[0]; if (file) void read(file); event.target.value = ''; }}/></label>
    <p role="status" className={styles.help}>{phase === 'sending' ? 'Добавляем материалы… ' : ''}{status}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {lookupFailed && <button className="btn btn-outline" disabled={phase !== 'idle'} onClick={() => { setError(''); request.current?.abort(); const controller = new AbortController(); request.current = controller; void verify(rows, controller); }}>Повторить проверку каталога</button>}
    {!!rows.length && <><p className={styles.summary}>{lookupFailed || phase === 'checking' ? `Требуют проверки: ${rows.length}.` : `Допустимых: ${ready}. С ошибками: ${failures}. Добавлено: ${imported}.`}</p>
      <ol className={styles.preview} aria-label="Предпросмотр ведомости">{rows.map(row => <li key={row.sourceLine} className={styles.row}>
        <div><span className={styles.line}>Строка {row.sourceLine}</span><b>{row.product?.name || 'Товар пока не определён'}</b><small>ID: {row.productId || 'не указан'}</small></div>
        <dl><div><dt>Количество</dt><dd>{row.product && Number.isSafeInteger(row.quantity) && row.quantity > 0 ? quantityUnit(row.quantity, row.product.unit) : `${row.quantityText || '—'} ${row.product?.unit || ''}`}</dd></div><div><dt>Дата этапа</dt><dd>{row.stageDate || 'Без даты'}</dd></div></dl>
        <p className={row.error || row.sendError ? 'form-error' : styles.help}>{row.error || (row.imported ? 'Добавлено' : row.sendError ? `Не подтверждено: ${row.sendError}` : lookupFailed || phase === 'checking' ? 'Товар требует проверки' : 'Готово к добавлению')}</p>
      </li>)}</ol>
      <div className={styles.actions}><button className="btn btn-dark" disabled={locked || !ready} onClick={() => void submit()}>Добавить допустимые строки ({ready})</button>
      {rows.some(row => row.sendError) && <button className="btn btn-outline" disabled={locked} onClick={() => void submit(true)}>Повторить неподтверждённые строки</button>}</div>
      <p className={styles.help}>Успешные строки этого предпросмотра повторно не отправляются. Если ответ потерян, строка могла сохраниться: перед повтором проверьте перечень или перезагрузите объект. После загрузки файла заново уже добавленные строки могут дублироваться — удалите их из файла.</p>
    </>}
  </section>;
}
