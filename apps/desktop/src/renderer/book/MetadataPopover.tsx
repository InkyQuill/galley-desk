import { AnchoredLayer } from '../ui/AnchoredLayer';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { IconBraces, IconX } from '@tabler/icons-react';
import { frontmatter, metadataReplacement } from '../../shared/metadata';
import { Tooltip } from '../ui/Tooltip';
import { Metadata } from './Metadata';

export type MetadataPopoverHandle = { requestDismiss: () => Promise<boolean> };

export const MetadataPopover = forwardRef<MetadataPopoverHandle, {
  source: string; readOnly: boolean; onSave: (yaml: string, source: string) => Promise<void>; onEditing: (editing: boolean) => void;
}>(({ source, readOnly, onSave, onEditing }, ref) => {
  const parsed = frontmatter(source);
  const originalYaml = parsed?.yaml ?? '';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ yaml: string; originalYaml: string; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingResolve = useRef<((discarded: boolean) => void) | null>(null);
  const pendingPromise = useRef<Promise<boolean> | null>(null);
  const stateRef = useRef({ open, saving, dirty: draft !== null && draft.yaml !== draft.originalYaml });
  stateRef.current = { open, saving, dirty: draft !== null && draft.yaml !== draft.originalYaml };

  const finishClose = (): void => {
    setOpen(false); setDraft(null); setError(null); setConfirming(false); onEditing(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const requestDismiss = (): Promise<boolean> => {
    const state = stateRef.current;
    if (!state.open) return Promise.resolve(true);
    if (state.saving) return Promise.resolve(false);
    if (!state.dirty) { finishClose(); return Promise.resolve(true); }
    if (pendingPromise.current !== null) return pendingPromise.current;
    setConfirming(true);
    pendingPromise.current = new Promise(resolve => { pendingResolve.current = resolve; });
    return pendingPromise.current;
  };
  useImperativeHandle(ref, () => ({ requestDismiss }));
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      if ((event.target as Element).closest('.book__metadata-popover') || triggerRef.current?.contains(event.target as Node)) return;
      void requestDismiss();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  });
  useEffect(() => {
    if (!open || !readOnly) return;
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, [open, readOnly]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!confirming) void requestDismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });
  const answerDiscard = (discard: boolean): void => {
    const resolve = pendingResolve.current; pendingResolve.current = null; pendingPromise.current = null; setConfirming(false);
    if (discard) finishClose(); else requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
    resolve?.(discard);
  };
  const invalid = parsed?.error ?? null;
  return <div className="book__metadata-anchor">
    <Tooltip content={invalid ? `Метаданные главы: ${invalid}` : 'Метаданные главы'}>
      <button ref={triggerRef} type="button" className={`book__metadata-trigger${invalid ? ' book__metadata-trigger--invalid' : ''}`} aria-label="Метаданные главы" aria-expanded={open} onClick={() => {
        if (open) { void requestDismiss(); return; }
        setDraft({ yaml: originalYaml, originalYaml, source }); setError(null); setOpen(true); onEditing(!readOnly);
      }}><IconBraces size={18} /></button>
    </Tooltip>
    {open && draft !== null && <AnchoredLayer anchor={triggerRef} align="right" className="book__metadata-popover"><div ref={dialogRef} role="dialog" aria-label="Метаданные главы" tabIndex={-1}>
      <div className="book__metadata-heading"><h3>Метаданные</h3><button type="button" aria-label="Закрыть метаданные" disabled={saving} onClick={() => void requestDismiss()}><IconX size={18} /></button></div>
      <Metadata yaml={draft.yaml} readOnly={readOnly} saving={saving} error={error} parseError={invalid}
        onChange={yaml => { setDraft(current => current === null ? null : { ...current, yaml }); setError(null); }}
        onSave={() => {
          setError(null);
          try { metadataReplacement(draft.source, draft.yaml); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить'); return; }
          setSaving(true);
          void onSave(draft.yaml, draft.source).then(finishClose, cause => setError(cause instanceof Error ? cause.message : 'Не удалось сохранить')).finally(() => setSaving(false));
        }} />
      {confirming && <div className="book__metadata-discard" role="alertdialog" aria-label="Отбросить изменения?">
        <p>Отбросить изменения?</p><button type="button" autoFocus onClick={() => answerDiscard(false)}>Продолжить редактирование</button><button type="button" onClick={() => answerDiscard(true)}>Отбросить</button>
      </div>}
    </div></AnchoredLayer>}
  </div>;
});
MetadataPopover.displayName = 'MetadataPopover';
