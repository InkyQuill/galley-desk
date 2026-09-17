// A React error boundary for the whole renderer tree: a render exception
// leaves the window in an unusable half-drawn state, so the fallback offers
// only an explicit restart -- never an automatic attempt to resume from
// whatever state produced the crash (that state is exactly what is
// suspect). Unsaved input is not recovered here; the book-service flush
// path (main/ipc.ts's flushRenderer, main/book-service.ts) is the only
// place unsaved text is protected, and it runs independently of this
// component's lifecycle.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from './report-error';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    reportError('react-render-failed', error);
  }

  private restart = (): void => {
    // A full process relaunch is not exposed over IPC (see the plan's scope
    // note); reloading the renderer discards the crashed component tree and
    // re-runs main.tsx from a clean slate, which is what "restart" means
    // from this window's perspective.
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="error-boundary">
        <p className="error-boundary__title">Приложение столкнулось с ошибкой отображения.</p>
        <p className="error-boundary__hint">
          Несохранённый ввод не восстанавливается автоматически. Перезапустите окно, чтобы продолжить работу.
        </p>
        <button type="button" className="error-boundary__restart" onClick={this.restart}>
          Перезапустить
        </button>
      </div>
    );
  }
}
