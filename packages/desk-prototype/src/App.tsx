import { useEffect, useState } from 'react';
import { AppearancePanel } from './appearance/AppearancePanel';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterContent } from './components/ChapterContent';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { RecordPopup } from './components/RecordPopup';
import { ReviewSidebar } from './components/ReviewSidebar';
import { SignalPicker } from './components/SignalPicker';
import { book, findChapter } from './data/fixtures';
import type { RecordMarker, SignalType } from './data/fixtures';
import type { ViewMode } from './types';

type DraftSelection = { from: number; to: number; x: number; y: number };

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;
  const [records, setRecords] = useState<RecordMarker[]>(activeChapter.records);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);

  useEffect(() => {
    setRecords(activeChapter.records);
    setSelectedRecordId(null);
    setDraftSelection(null);
  }, [activeChapter]);

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  const handleSaveComment = (recordId: string, comment: string): void => {
    setRecords((current) => current.map((record) => (record.id === recordId && record.kind === 'signal' ? { ...record, comment } : record)));
  };

  const handleDelete = (recordId: string): void => {
    setRecords((current) => current.filter((record) => record.id !== recordId));
  };

  const handlePickSignal = (type: SignalType): void => {
    if (draftSelection === null) return;
    const newRecord: RecordMarker = {
      id: `draft-${Date.now()}`,
      kind: 'signal',
      from: draftSelection.from,
      to: draftSelection.to,
      signalType: type,
      comment: '',
    };
    setRecords((current) => [...current, newRecord]);
    setSelectedRecordId(newRecord.id);
    setDraftSelection(null);
  };

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => setAppearanceOpen((open) => !open)}
          searchText={activeChapter.text}
        />
        {appearanceOpen && <AppearancePanel />}
        <div className="flex gap-3">
          {!zen && <ChapterSidebar chapters={book.chapters} activeChapterId={chapterId} onSelect={setChapterId} />}
          <div className="relative flex-1">
            <ChapterContent
              chapter={activeChapter}
              records={records}
              onMarkerActivate={setSelectedRecordId}
              onTextSelect={setDraftSelection}
            />
            {draftSelection !== null && (
              <SignalPicker x={draftSelection.x} y={draftSelection.y} onPick={handlePickSignal} onDismiss={() => setDraftSelection(null)} />
            )}
            {selectedRecord !== null && (
              <div style={{ position: 'fixed', left: 0, right: 0, top: '30%', display: 'flex', justifyContent: 'center' }}>
                <RecordPopup record={selectedRecord} onClose={() => setSelectedRecordId(null)} onSaveComment={handleSaveComment} onDelete={handleDelete} />
              </div>
            )}
          </div>
          {!zen && <ReviewSidebar chapterNote={activeChapter.note} records={records} onSelect={setSelectedRecordId} />}
        </div>
      </div>
    </AppearanceProvider>
  );
}
