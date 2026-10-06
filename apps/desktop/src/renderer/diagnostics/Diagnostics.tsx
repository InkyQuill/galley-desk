import { useEffect, useRef, useState } from 'react';
import { IconClipboard, IconFolderOpen, IconX } from '@tabler/icons-react';
import type { DiagnosticInfo } from '../../shared/api';

// Read-only info + two explicit, argument-free actions (see shared/api.ts's
// DeskApi.diagnosticInfo/openLogsFolder/copyDiagnosticInfo). No book text,
// comment or path is ever shown here, and nothing is ever sent automatically
// -- "copy" only puts text on the clipboard on an explicit, separate click.
// Follows the same native <dialog> + showModal() convention as
// book/BookManagement.tsx: Escape fires onCancel (prevented so the parent
// unmounts it instead), and the invoking button explicitly regains focus
// (see TitleBar.tsx's closeDiagnostics), matching this codebase's existing
// pattern rather than relying on the browser's own (unused here) automatic
// dialog focus-restore.

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Операция не выполнена';
}

const LOGGING_LABEL: Record<DiagnosticInfo['logging'], string> = {
  ready: 'Ведётся',
  unavailable: 'Недоступен',
};

export function Diagnostics({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<DiagnosticInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyFolder, setBusyFolder] = useState(false);
  const [busyCopy, setBusyCopy] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    let cancelled = false;
    window.desk
      .diagnosticInfo()
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openFolder = async (): Promise<void> => {
    setFolderError(null);
    setBusyFolder(true);
    try {
      await window.desk.openLogsFolder();
    } catch (cause) {
      // A shell.openPath failure (or a missing/uncreatable logs folder) must
      // be visible in the panel, not only logged to the console.
      setFolderError(errorText(cause));
    } finally {
      setBusyFolder(false);
    }
  };

  const copyInfo = async (): Promise<void> => {
    setCopyError(null);
    setCopied(false);
    setBusyCopy(true);
    try {
      await window.desk.copyDiagnosticInfo();
      setCopied(true);
    } catch (cause) {
      setCopyError(errorText(cause));
    } finally {
      setBusyCopy(false);
    }
  };

  // Closing always goes through the native dialog.close() rather than
  // calling onClose() directly: HTML's <dialog> remembers the element that
  // was focused before showModal() and restores focus to it automatically
  // once close() actually runs (a manual .focus() call from the parent,
  // performed synchronously in the same event handler while the dialog
  // element is still mounted and still in modal/top-layer state, is
  // overridden by the browser's own focus trap and gets lost). The
  // subsequent native 'close' event is what unmounts this component via the
  // parent's onClose.
  const requestClose = (): void => {
    dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="diagnostics"
      aria-labelledby="diagnostics-title"
      onCancel={(event) => {
        // Let the platform run its own close (which fires 'close' below and
        // restores focus); only the parent's unmount is deferred to that
        // event, never triggered from here directly.
        event.preventDefault();
        requestClose();
      }}
      onClose={onClose}
    >
      <header>
        <h2 id="diagnostics-title">Диагностика</h2>
        <button type="button" className="diagnostics__close" aria-label="Закрыть диагностику" onClick={requestClose}>
          <IconX />
        </button>
      </header>
      <p className="diagnostics__note">
        Журнал хранится только локально на этом компьютере: текст книги,
        комментарии и пути к файлам в него никогда не записываются, и ничего
        не отправляется автоматически.
      </p>
      {loadError !== null && <p role="alert">{loadError}</p>}
      {info !== null && (
        <dl className="diagnostics__info">
          <div>
            <dt>Версия приложения</dt>
            <dd>{info.appVersion}</dd>
          </div>
          <div>
            <dt>Сборка</dt>
            <dd>{info.build}</dd>
          </div>
          <div>
            <dt>Платформа</dt>
            <dd>{info.platform} ({info.arch})</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{info.electron}</dd>
          </div>
          <div>
            <dt>Редактор</dt>
            <dd>{info.editor}</dd>
          </div>
          <div>
            <dt>Темы</dt>
            <dd>{info.themes}</dd>
          </div>
          <div>
            <dt>Журнал</dt>
            <dd>{LOGGING_LABEL[info.logging]}</dd>
          </div>
        </dl>
      )}
      <div className="diagnostics__actions">
        <button type="button" disabled={busyFolder} onClick={() => void openFolder()}>
          <IconFolderOpen size={16} />
          Открыть папку журнала
        </button>
        <button type="button" disabled={busyCopy} onClick={() => void copyInfo()}>
          <IconClipboard size={16} />
          Скопировать сведения
        </button>
      </div>
      {folderError !== null && <p role="alert">{folderError}</p>}
      {copyError !== null && <p role="alert">{copyError}</p>}
      {copied && <p role="status">Сведения скопированы в буфер обмена</p>}
    </dialog>
  );
}
