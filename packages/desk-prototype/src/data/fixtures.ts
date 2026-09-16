export type SignalType = 'note' | 'change_required' | 'warning' | 'review';

export type EditMarker = {
  id: string;
  kind: 'edit';
  from: number;
  to: number;
  before: string;
  after: string;
};

export type SignalMarker = {
  id: string;
  kind: 'signal';
  from: number;
  to: number;
  signalType: SignalType;
  comment: string;
};

export type RecordMarker = EditMarker | SignalMarker;

export type Chapter = {
  id: string;
  title: string;
  text: string;
  note: string;
  records: RecordMarker[];
  missing?: boolean;
};

export type Book = {
  id: string;
  title: string;
  chapters: Chapter[];
};

/** Находит подстроку в тексте главы и возвращает её диапазон — фикстуры
 * задают правки/сигналы по содержимому, а не по хрупким числовым индексам. */
function span(text: string, needle: string): { from: number; to: number } {
  const from = text.indexOf(needle);
  if (from === -1) throw new Error(`Фикстура: подстрока не найдена: «${needle}»`);
  return { from, to: from + needle.length };
}

const prologueText =
  'Море не прощает тех, кто приходит к нему без имени. Капитан знал это лучше многих — он потерял своё имя ещё до того, как впервые ступил на палубу. Ветер крепчал с каждым часом, и такелаж пел тревожную песню.';

const prologueEditSpan = span(prologueText, 'крепчал с каждым часом');
const prologueSignalSpan = span(prologueText, 'потерял своё имя');

const departureText =
  'Корабль отчалил от причала на рассвете. Боцман проверил такелаж дважды, но верёвки всё равно скрипели тревожно. Команда молчала, будто предчувствуя недоброе.';

const departureEdit1Span = span(departureText, 'отчалил');
const departureEdit2Span = span(departureText, 'скрипели тревожно');
const departureNoteSpan = span(departureText, 'такелаж дважды');
const departureWarningSpan = span(departureText, 'предчувствуя недоброе');

const stormText = 'Шторм ударил в полночь. Волны перехлёстывали через борт, и капитан приказал убрать паруса.';

const stormReviewSpan = span(stormText, 'убрать паруса');

export const book: Book = {
  id: 'book-1',
  title: 'Хроники Пепельного моря',
  chapters: [
    {
      id: 'ch-1',
      title: 'Пролог',
      note: 'Сверить даты отплытия с главой 4.',
      text: prologueText,
      records: [
        {
          id: 'rec-1',
          kind: 'edit',
          from: prologueEditSpan.from,
          to: prologueEditSpan.to,
          before: 'дул сильнее',
          after: 'крепчал с каждым часом',
        },
        {
          id: 'rec-2',
          kind: 'signal',
          from: prologueSignalSpan.from,
          to: prologueSignalSpan.to,
          signalType: 'change_required',
          comment: 'Уточнить, когда именно капитан потерял имя.',
        },
      ],
    },
    {
      id: 'ch-2',
      title: 'Глава 1. Отплытие',
      note: '',
      text: departureText,
      records: [
        {
          id: 'rec-3',
          kind: 'edit',
          from: departureEdit1Span.from,
          to: departureEdit1Span.to,
          before: 'отошёл',
          after: 'отчалил',
        },
        {
          id: 'rec-4',
          kind: 'edit',
          from: departureEdit2Span.from,
          to: departureEdit2Span.to,
          before: 'скрипели глухо',
          after: 'скрипели тревожно',
        },
        {
          id: 'rec-5',
          kind: 'signal',
          from: departureNoteSpan.from,
          to: departureNoteSpan.to,
          signalType: 'note',
          comment: 'Проверить, боцман или штурман должен это делать.',
        },
        {
          id: 'rec-6',
          kind: 'signal',
          from: departureWarningSpan.from,
          to: departureWarningSpan.to,
          signalType: 'warning',
          comment: '',
        },
      ],
    },
    {
      id: 'ch-3',
      title: 'Глава 2. Шторм',
      note: '',
      text: stormText,
      records: [
        {
          id: 'rec-7',
          kind: 'signal',
          from: stormReviewSpan.from,
          to: stormReviewSpan.to,
          signalType: 'review',
          comment: 'Сверить с картой ветров из главы 5.',
        },
      ],
    },
    {
      id: 'ch-4',
      title: 'Глава 3. Берег',
      note: '',
      text: '',
      records: [],
      missing: true,
    },
  ],
};

export function findChapter(bookValue: Book, chapterId: string): Chapter | null {
  return bookValue.chapters.find((chapter) => chapter.id === chapterId) ?? null;
}
