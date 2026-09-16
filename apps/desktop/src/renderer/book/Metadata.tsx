import { useState } from 'react';
import { IconEdit, IconCheck, IconX } from '@tabler/icons-react';
import { frontmatter, metadataReplacement } from '../../shared/metadata';

export function Metadata({
  source,
  readOnly,
  onSave,
  onEditing,
}: {
  source: string;
  readOnly: boolean;
  onSave: (yaml: string, source: string) => Promise<void>;
  onEditing: (editing: boolean) => void;
}) {
  const fm = frontmatter(source);
  const [draft, setDraft] = useState<{ yaml: string; source: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = () => {
    setDraft(null);
    setError(null);
    onEditing(false);
  };
  return (
    <section className="book__metadata" aria-label="Метаданные главы">
      <div className="book__metadata-heading">
        <span>Метаданные</span>
        {draft === null && (
          <button
            type="button"
            aria-label="Изменить метаданные"
            disabled={readOnly}
            onClick={() => {
              setDraft({ yaml: fm?.yaml ?? '', source });
              onEditing(true);
            }}
          >
            <IconEdit size={16} />
            {fm ? 'Изменить' : 'Добавить'}
          </button>
        )}
      </div>
      {draft === null ? (
        <>
          {fm && (
            <details>
              <summary>
                {fm.title ?? 'YAML'}
                {fm.error ? ' — ошибка' : ''}
              </summary>
              <pre>{fm.yaml}</pre>
            </details>
          )}
          {fm?.error && <p role="alert">{fm.error}</p>}
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            try {
              metadataReplacement(draft.source, draft.yaml);
              setSaving(true);
              await onSave(draft.yaml, draft.source);
              close();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : 'Не удалось сохранить',
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            YAML без разделителей
            <textarea
              autoFocus
              aria-label="YAML метаданных"
              value={draft.yaml}
              disabled={saving}
              onChange={(event) =>
                setDraft({ ...draft, yaml: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !saving) {
                  event.stopPropagation();
                  close();
                }
              }}
            />
          </label>
          <p>
            Сохранение изменяет исходник и очищает историю отмены этой главы.
            Текст главы и записи рецензии сохраняются.
          </p>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={saving || readOnly}>
            <IconCheck size={16} />
            Сохранить метаданные
          </button>
          <button type="button" disabled={saving} onClick={close}>
            <IconX size={16} />
            Отмена
          </button>
        </form>
      )}
    </section>
  );
}
