'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import styles from './project-editor.module.css';

export function ProjectEditor({ project, onUpdated }: { project: Project; onUpdated: (updated: Project) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [address, setAddress] = useState(project.address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { if (!busy) setOpen(false); };
  const dialogRef = useDialogFocus(open, close, '[data-project-editor-trigger]');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.length > 150 || !address.trim() || address.length > 300) {
      setError('Укажите название до 150 символов и адрес до 300 символов. Поля не могут состоять только из пробелов.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api<Project>(`/projects/${project.id}`, {
        method: 'PATCH', body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      setOpen(false);
      onUpdated(updated);
    } catch (issue) {
      setError(`Не удалось сохранить объект. ${issue instanceof Error ? issue.message : 'Повторите попытку.'}`);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button className="btn btn-outline" data-project-editor-trigger onClick={() => {
      setName(project.name); setAddress(project.address); setError(''); setOpen(true);
    }}><Pencil size={17} aria-hidden="true"/> Изменить объект</button>
    {open && <div className={`modal-backdrop ${styles.backdrop}`} onMouseDown={event => {
      if (event.target === event.currentTarget) close();
    }}>
      <div ref={dialogRef} tabIndex={-1} className={`auth-modal ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="Изменить объект" aria-busy={busy}>
        <button className="modal-close icon-button" onClick={close} aria-label="Закрыть" disabled={busy}><X size={20}/></button>
        <span className="overline">СТРОИТЕЛЬНЫЙ ОБЪЕКТ</span>
        <h2>Изменить объект</h2>
        <p>Уточните название и адрес для планирования закупки.</p>
        <form onSubmit={save} className="form-stack">
          <label>Название<input required maxLength={150} value={name} disabled={busy} onChange={event => setName(event.target.value)} aria-describedby="project-name-limit"/></label>
          <small id="project-name-limit" className="muted">До 150 символов</small>
          <label>Адрес<input required maxLength={300} value={address} disabled={busy} onChange={event => setAddress(event.target.value)} aria-describedby="project-address-limit"/></label>
          <small id="project-address-limit" className="muted">До 300 символов</small>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className="btn btn-outline" onClick={close} disabled={busy}>Отмена</button>
            <button className="btn btn-dark" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить изменения'} <Check size={16} aria-hidden="true"/></button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}
