import { IconCheck } from '@tabler/icons-react';

export function Metadata({ yaml, readOnly, saving, error, parseError, onChange, onSave }: {
  yaml: string; readOnly: boolean; saving: boolean; error: string | null; parseError: string | null;
  onChange: (yaml: string) => void; onSave: () => void;
}) {
  if (readOnly) return <div className="book__metadata-view">
    <pre aria-label="YAML метаданных">{yaml || 'Метаданные не заданы'}</pre>
    {parseError !== null && <p role="alert">{parseError}</p>}
  </div>;
  return <form onSubmit={event => { event.preventDefault(); onSave(); }}>
    <label>YAML без разделителей<textarea autoFocus aria-label="YAML метаданных" value={yaml} disabled={saving} onChange={event => onChange(event.target.value)} /></label>
    <p>Сохранение изменяет исходник и очищает историю отмены этой главы. Текст главы и записи рецензии сохраняются.</p>
    {(error ?? parseError) !== null && <p role="alert">{error ?? parseError}</p>}
    <button type="submit" disabled={saving}><IconCheck size={16} />{saving ? 'Сохраняется…' : 'Сохранить метаданные'}</button>
  </form>;
}
