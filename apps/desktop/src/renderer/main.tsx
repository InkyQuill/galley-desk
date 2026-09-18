import { createRoot } from 'react-dom/client';

import { App } from './App';
import './app.css';
import { ErrorBoundary } from './diagnostics/ErrorBoundary';
import { reportError } from './diagnostics/report-error';

// Uncaught renderer exceptions and rejected promises never reach main's
// uncaughtExceptionMonitor (that only observes the main process) -- this is
// the renderer's own last line, reporting the same closed vocabulary through
// window.desk.reportDiagnostic. React render failures are caught separately
// by ErrorBoundary below, since they don't reach window.onerror.
window.addEventListener('error', (event) => {
  reportError('unhandled-renderer', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled-renderer', event.reason);
});

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
