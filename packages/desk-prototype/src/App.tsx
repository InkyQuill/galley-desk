import { useEffect, useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterContent } from './components/ChapterContent';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { book, findChapter } from './data/fixtures';
import type { RecordMarker } from './data/fixtures';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;
  const [records, setRecords] = useState<RecordMarker[]>(activeChapter.records);

  useEffect(() => {
    setRecords(activeChapter.records);
  }, [activeChapter]);

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
          <div className="flex-1">
            <ChapterContent chapter={activeChapter} records={records} onMarkerActivate={() => undefined} />
          </div>
        </div>
      </div>
    </AppearanceProvider>
  );
}
