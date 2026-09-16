import { useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { Header } from './components/Header';
import { book } from './data/fixtures';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => undefined}
          searchText=""
        />
      </div>
    </AppearanceProvider>
  );
}
