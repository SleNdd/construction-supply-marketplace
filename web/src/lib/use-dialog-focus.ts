'use client';

import { useEffect, useRef } from 'react';

const focusable = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Удерживает фокус в диалоге и возвращает его после закрытия.
export function useDialogFocus(open: boolean, onClose: () => void, returnSelector?: string) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstField = dialog.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)');
    (firstField || dialog.querySelector<HTMLElement>(focusable) || dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter(item => item.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => {
        const replacement = returnSelector ? document.querySelector<HTMLElement>(returnSelector) : null;
        const target = previous?.isConnected ? previous : (replacement?.getClientRects().length ? replacement : document.getElementById('main-content'));
        target?.focus();
      });
    };
  }, [open, returnSelector]);

  return dialogRef;
}
