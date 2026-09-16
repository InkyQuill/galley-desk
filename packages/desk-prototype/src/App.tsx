import { useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { book, findChapter } from './data/fixtures';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;

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
          searchText={activeChapter.text}
        />
        <div className="flex gap-3">
          {!zen && <ChapterSidebar chapters={book.chapters} activeChapterId={chapterId} onSelect={setChapterId} />}
        </div>
      </div>
    </AppearanceProvider>
  );
}
