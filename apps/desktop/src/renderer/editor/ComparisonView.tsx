// Вид «Сравнение»: read-only исходник, в котором каждая активная правка
// показана парой отдельных диапазонов old/new (удалённый текст + введённый),
// а сигналы — подложкой в цвете типа и молнией. Никакого diff по textContent:
// сегменты строятся из производного текста и позиций записей (одна функция
// buildComparisonNodes), введённый текст сравнения неизменяем.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { RecordView, Snapshot } from '../../shared/api';
import { comparisonTint, useMarkerTheme, deletionColor, signalColor } from './markers';
import type { SignalTypeName } from './markers';
import type { ComparisonSegment } from '../search/search';

type SigMark = { id: string; type: SignalTypeName };

export type ComparisonNode =
  | { kind: 'text'; text: string; marks: SigMark[]; ends: SigMark[] }
  | { kind: 'edit'; id: string; before: string; after: string; ends: SigMark[] };

type Piece =
  | { kind: 'text'; text: string; derivedFrom: number; displayStart: number }
  | { kind: 'edit'; record: RecordView; derivedFrom: number; derivedTo: number; displayStart: number };

/**
 * Явные координаты кусков сравнения: производный текст между активными
 * правками и заменяющие куски. Потребители (поиск) переводят производные
 * координаты в display через comparisonSegments, геометрия живёт только здесь.
 */
export function buildComparisonPieces(snapshot: Snapshot): Piece[] {
  const edits = snapshot.records
    .filter((record) => record.kind === 'edit' && record.status === 'active' && record.from !== null && record.to !== null)
    .sort((left, right) => (left.from as number) - (right.from as number));

  const pieces: Piece[] = [];
  let derived = 0;
  let display = 0;
  for (const edit of edits) {
    const from = edit.from as number;
    const to = edit.to as number;
    if (from > derived) {
      const text = snapshot.text.slice(derived, from);
      pieces.push({ kind: 'text', text, derivedFrom: derived, displayStart: display });
      display += text.length;
    }
    pieces.push({ kind: 'edit', record: edit, derivedFrom: from, derivedTo: to, displayStart: display });
    display += edit.before.length + edit.after.length;
    derived = to;
  }
  if (derived < snapshot.text.length) {
    pieces.push({ kind: 'text', text: snapshot.text.slice(derived), derivedFrom: derived, displayStart: display });
  }
  return pieces;
}

/**
 * Сегменты для поиска: та же геометрия в форме search.ComparisonSegment —
 * введённая часть правки отображается со сдвигом на длину before.
 */
export function comparisonSegments(snapshot: Snapshot): ComparisonSegment[] {
  return buildComparisonPieces(snapshot).map((piece) =>
    piece.kind === 'text'
      ? {
          kind: 'text' as const,
          derivedFrom: piece.derivedFrom,
          derivedTo: piece.derivedFrom + piece.text.length,
          displayStart: piece.displayStart,
        }
      : {
          kind: 'edit' as const,
          derivedFrom: piece.derivedFrom,
          derivedTo: piece.derivedTo,
          displayStart: piece.displayStart,
          beforeLength: piece.record.before.length,
        },
  );
}

/**
 * Строит узлы сравнения из source-сегментов и активных правок: неизменённые
 * сегменты производного текста между правками и пара old/new на каждую правку.
 * Диапазоны сигналов заданы в производных координатах и переводятся в
 * display-координаты здесь же (введённая правкой часть сдвинута на длину old).
 */
export function buildComparisonNodes(snapshot: Snapshot): ComparisonNode[] {
  const edits = snapshot.records
    .filter((record) => record.kind === 'edit' && record.status === 'active' && record.from !== null && record.to !== null)
    .sort((left, right) => (left.from as number) - (right.from as number));
  const signals = snapshot.records.filter(
    (record) => record.kind === 'signal' && record.status === 'active' && record.from !== null && record.to !== null,
  );

  const pieces: Piece[] = buildComparisonPieces(snapshot);

  // Подложки сигналов внутри кусков и позиции молний (конец диапазона);
  // конец сигнала хранится как смещение внутри своего куска (display).
  const marksByPiece = new Map<number, { start: number; end: number; mark: SigMark }[]>();
  const endsByPiece = new Map<number, { at: number; mark: SigMark }[]>();
  for (const signal of signals) {
    const from = signal.from as number;
    const to = signal.to as number;
    const mark: SigMark = { id: signal.id, type: signal.signalType ?? 'note' };
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index]!;
      if (piece.kind === 'text') {
        const derivedTo = piece.derivedFrom + piece.text.length;
        if (from < derivedTo && to > piece.derivedFrom) {
          const start = Math.max(from, piece.derivedFrom) - piece.derivedFrom;
          const end = Math.min(to, derivedTo) - piece.derivedFrom;
          const marks = marksByPiece.get(index) ?? [];
          marks.push({ start, end, mark });
          marksByPiece.set(index, marks);
        }
        if (to >= piece.derivedFrom && to <= derivedTo) {
          const ends = endsByPiece.get(index) ?? [];
          ends.push({ at: to - piece.derivedFrom, mark });
          endsByPiece.set(index, ends);
          break;
        }
      } else {
        // Внутри заменяющего куска производные координаты — это введённый текст.
        if (from < piece.derivedTo && to > piece.derivedFrom) {
          const start = Math.max(from, piece.derivedFrom) - piece.derivedFrom;
          const end = Math.min(to, piece.derivedTo) - piece.derivedFrom;
          const marks = marksByPiece.get(index) ?? [];
          marks.push({ start, end, mark });
          marksByPiece.set(index, marks);
        }
        if (to >= piece.derivedFrom && to <= piece.derivedTo) {
          const ends = endsByPiece.get(index) ?? [];
          ends.push({ at: piece.record.before.length + (to - piece.derivedFrom), mark });
          endsByPiece.set(index, ends);
          break;
        }
      }
    }
  }

  const nodes: ComparisonNode[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!;
    const pieceEnds = endsByPiece.get(index) ?? [];
    if (piece.kind === 'edit') {
      // Конец сигнала внутри/на краю введённой части — молния сразу после неё.
      nodes.push({
        kind: 'edit',
        id: piece.record.id,
        before: piece.record.before,
        after: piece.record.after,
        ends: pieceEnds.filter((candidate) => candidate.at >= piece.record.before.length).map((candidate) => candidate.mark),
      });
      continue;
    }
    // Неизменённый сегмент режется по границам подложек сигналов.
    const marks = (marksByPiece.get(index) ?? []).slice().sort((left, right) => left.start - right.start);
    const bounds = new Set<number>([0, piece.text.length]);
    for (const { start, end } of marks) {
      bounds.add(start);
      bounds.add(end);
    }
    const sorted = [...bounds].sort((left, right) => left - right);
    for (let bound = 0; bound < sorted.length - 1; bound++) {
      const start = sorted[bound]!;
      const end = sorted[bound + 1]!;
      if (end <= start) continue;
      const sliceMarks = marks.filter((candidate) => candidate.start <= start && candidate.end >= end).map((candidate) => candidate.mark);
      nodes.push({
        kind: 'text',
        text: piece.text.slice(start, end),
        marks: sliceMarks,
        ends: pieceEnds.filter((candidate) => candidate.at === end).map((candidate) => candidate.mark),
      });
    }
  }
  return nodes;
}

type Props = {
  snapshot: Snapshot;
  onRecordClick: (record: RecordView, rect: DOMRect) => void;
};

function RecordMarkerButton({
  record,
  onRecordClick,
}: {
  record: RecordView;
  onRecordClick: Props['onRecordClick'];
}) {
  const theme = useMarkerTheme();
  const isEdit = record.kind === 'edit';
  const deletion = isEdit && record.after === '';
  const color = isEdit ? (deletion ? deletionColor(theme) : undefined) : signalColor(record.signalType ?? 'note', theme);
  return (
    <button
      type="button"
      data-record-id={record.id}
      aria-label={isEdit ? (deletion ? `Удаление: ${record.before}` : 'Правка') : 'Сигнал'}
      title={
        isEdit
          ? deletion
            ? `Удаление: ${record.before}`
            : `Правка: ${record.before} → ${record.after}`
          : `Сигнал [${record.signalType ?? 'note'}]${record.comment !== '' ? `: ${record.comment}` : ''}`
      }
      style={{
        border: 'none',
        background: 'transparent',
        color: color ?? 'inherit',
        cursor: 'pointer',
        padding: '0 2px',
        font: 'inherit',
      }}
      onClick={(event) => onRecordClick(record, event.currentTarget.getBoundingClientRect())}
    >
      {isEdit ? '✎' : '⚡'}
    </button>
  );
}

export function ComparisonView({ snapshot, onRecordClick }: Props) {
  const nodes = useMemo(() => buildComparisonNodes(snapshot), [snapshot]);
  const theme = useMarkerTheme();
  const records = useMemo(() => new Map(snapshot.records.map((record) => [record.id, record])), [snapshot]);
  const content: ReactNode[] = [];
  nodes.forEach((node, index) => {
    if (node.kind === 'edit') {
      const record = records.get(node.id);
      content.push(
        <span key={`edit:${node.id}:${index}`}>
          <del style={{ background: comparisonTint('deletion', theme) }}>{node.before}</del>
          <ins style={{ background: comparisonTint('addition', theme), textDecoration: 'none' }}>{node.after}</ins>
          {record !== undefined && <RecordMarkerButton record={record} onRecordClick={onRecordClick} />}
        </span>,
      );
    } else if (node.text !== '') {
      const color = node.marks.length > 0 ? signalColor(node.marks[0]!.type, theme) : null;
      content.push(
        <span key={`text:${index}`}>
          <span
            style={
              color !== null
                ? {
                    background: `color-mix(in srgb, ${color} 16%, transparent)`,
                    textDecorationLine: 'underline',
                    textDecorationStyle: 'dotted',
                    textDecorationColor: color,
                  }
                : undefined
            }
          >
            {node.text}
          </span>
          {node.ends.map((end) => {
            const record = records.get(end.id);
            return record !== undefined ? <RecordMarkerButton key={end.id} record={record} onRecordClick={onRecordClick} /> : null;
          })}
        </span>,
      );
    }
  });
  return (
    <div className="book__source" role="region" aria-label="Сравнение">
      {content}
    </div>
  );
}
