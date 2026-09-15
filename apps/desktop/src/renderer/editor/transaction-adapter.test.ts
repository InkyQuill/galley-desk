import { EditorState } from '@codemirror/state';
import { expect, test } from 'vitest';
import { CommandQueue, TypingGroups, fromSnapshot, toTextChanges } from './transaction-adapter';
import type { Command, Snapshot } from '../../shared/api';

test('captures source positions through hidden markdown', () => {
  const state = EditorState.create({doc:'**кот**'});
  expect(toTextChanges(state.update({changes:{from:2,to:5,insert:'кит'}})))
    .toEqual([{from:2,to:5,insert:'кит'}]);
});

test('toTextChanges lists every change of a multi-edit transaction in order', () => {
  const state = EditorState.create({ doc: 'кот' });
  const tr = state.update({
    changes: [
      { from: 0, to: 1, insert: 'К' },
      { from: 3, to: 3, insert: '!' },
    ],
  });
  expect(toTextChanges(tr)).toEqual([
    { from: 0, to: 1, insert: 'К' },
    { from: 3, to: 3, insert: '!' },
  ]);
});

test('a pure selection transaction produces no text changes', () => {
  const state = EditorState.create({ doc: 'кот' });
  const tr = state.update({ selection: { anchor: 2 } });
  expect(toTextChanges(tr)).toEqual([]);
});

test('a fromSnapshot-tagged replacement is never reported as a user edit', () => {
  const state = EditorState.create({ doc: 'внешний текст' });
  const tr = state.update(
    { changes: { from: 0, to: state.doc.length, insert: 'локальный текст' } },
    { annotations: fromSnapshot.of(true) },
  );
  expect(toTextChanges(tr)).toEqual([]);
});

// --- Группы ввода (heuristic объединения пачек набора в один undo-шаг) ---

function groupTracker(): { groups: TypingGroups; ticks: number[]; ids: string[] } {
  const ticks: number[] = [];
  const ids: string[] = [];
  const groups = new TypingGroups(
    () => ticks.shift() ?? 0,
    () => {
      const id = `group-${ids.length + 1}`;
      ids.push(id);
      return id;
    },
  );
  return { groups, ticks, ids };
}

test('contiguous keystrokes within the idle window share one group', () => {
  const { groups, ticks } = groupTracker();
  // Каждый вызов next() читает часы дважды (проверка паузы + запоминание).
  ticks.push(0, 100, 100, 200);
  expect(groups.next({ from: 4, insert: 'а' }, false)).toBe('group-1');
  expect(groups.next({ from: 5, insert: 'б' }, false)).toBe('group-1');
  expect(groups.next({ from: 6, insert: 'в' }, false)).toBe('group-1');
});

test('a gap longer than the idle window starts a new group', () => {
  const { groups, ticks } = groupTracker();
  ticks.push(0, 1_000);
  expect(groups.next({ from: 4, insert: 'а' }, false)).toBe('group-1');
  expect(groups.next({ from: 5, insert: 'б' }, false)).toBe('group-2');
});

test('a jump of the insertion point starts a new group', () => {
  const { groups, ticks } = groupTracker();
  ticks.push(0, 100, 150);
  expect(groups.next({ from: 4, insert: 'а' }, false)).toBe('group-1');
  expect(groups.next({ from: 0, insert: 'х' }, false)).toBe('group-2');
});

test('an entire composition stays one group and typing after it starts a new one', () => {
  const { groups, ticks } = groupTracker();
  ticks.push(0, 100, 200, 300, 400);
  expect(groups.next({ from: 0, insert: 'к' }, true)).toBe('group-1');
  expect(groups.next({ from: 1, insert: 'о' }, true)).toBe('group-1');
  expect(groups.next({ from: 2, insert: 'т' }, true)).toBe('group-1');
  expect(groups.next({ from: 3, insert: '!' }, false)).toBe('group-2');
});

test('a selection change resets the group; the next keystroke starts a new one', () => {
  const { groups, ticks } = groupTracker();
  ticks.push(0, 100, 150, 200);
  expect(groups.next({ from: 4, insert: 'а' }, false)).toBe('group-1');
  groups.reset();
  expect(groups.next({ from: 5, insert: 'б' }, false)).toBe('group-2');
});

test('multi-change transactions always mint a fresh group', () => {
  const { groups, ticks } = groupTracker();
  ticks.push(0, 10, 11);
  expect(groups.next({ from: 4, insert: 'а' }, false)).toBe('group-1');
  expect(groups.fresh()).toBe('group-2');
  expect(groups.fresh()).toBe('group-3');
});

// --- Очередь команд: FIFO, счётчик незавершённых, блокировка после сбоя ---

type FakeSnapshot = Pick<Snapshot, 'revision' | 'text' | 'chapterId'>;

function snapshot(revision: number, text: string): Snapshot {
  return {
    bookId: 'book', chapterId: 'chapter', revision, text, sourceText: text,
    records: [], chapterNote: '', saveState: 'saved',
    canUndoInput: false, canRedoInput: false, canUndoApply: false, canRedoApply: false,
  } satisfies Snapshot;
}

type Harness = {
  queue: CommandQueue<FakeSnapshot, string>;
  sent: Command[];
  acks: FakeSnapshot[];
  failures: unknown[];
  delays: number[];
  push: (command: Command, ackRevision?: number, fail?: boolean) => void;
};

function makeQueue(): Harness {
  const sent: Command[] = [];
  const acks: FakeSnapshot[] = [];
  const failures: unknown[] = [];
  const delays: number[] = [];
  const queue = new CommandQueue<FakeSnapshot, string>({
    onAck: (ack, _command, context) => acks.push({ ...ack, chapterId: context }),
    onError: (error) => failures.push(error),
  });
  const harness: Harness = {
    queue,
    sent,
    acks,
    failures,
    delays,
    push(command, ackRevision = 1, fail = false) {
      queue.push(
        command,
        () => {
          sent.push(command);
          return new Promise<FakeSnapshot>((resolve, reject) => {
            setTimeout(() => (fail ? reject(new Error('SAVE_FAILED')) : resolve(snapshot(ackRevision, 'text'))), delays.shift() ?? 0);
          });
        },
        'chapter',
      );
    },
  };
  return harness;
}

const textCommand = (): Command => ({
  type: 'text',
  changes: [{ from: 0, to: 0, insert: 'x' }],
  selection: { anchor: 1, head: 1 },
});

test('the queue sends commands strictly in order and reports every ack', async () => {
  const harness = makeQueue();
  harness.delays = [30, 10, 20];
  harness.push(textCommand(), 2);
  harness.push(textCommand(), 3);
  harness.push(textCommand(), 4);
  expect(harness.queue.inFlight).toBe(3);
  await harness.queue.idle();
  expect(harness.sent).toHaveLength(3);
  expect(harness.acks.map((ack) => ack.revision)).toEqual([2, 3, 4]);
  expect(harness.queue.inFlight).toBe(0);
});

test('a failed command blocks further sends and reports the error once', async () => {
  const harness = makeQueue();
  harness.push(textCommand(), 2, true);
  await harness.queue.idle();
  expect(harness.failures).toHaveLength(1);
  expect(harness.queue.blocked).toBe(true);

  harness.push(textCommand(), 3);
  await harness.queue.idle();
  // После сбоя локальный текст сохраняется, а новые команды не отправляются.
  expect(harness.sent).toHaveLength(1);
  expect(harness.queue.blocked).toBe(true);

  harness.queue.unblock();
  expect(harness.queue.blocked).toBe(false);
  harness.push(textCommand(), 4);
  await harness.queue.idle();
  expect(harness.sent).toHaveLength(2);
});

test('history commands flag the syncing window; user edits mark it dirty', async () => {
  const harness = makeQueue();
  harness.delays = [20];
  harness.push({ type: 'undo-input' });
  expect(harness.queue.awaitingSync).toBe(true);
  harness.queue.markDirty();
  await harness.queue.idle();
  expect(harness.queue.awaitingSync).toBe(false);
  // Замена документа по ack отменяется, если во время undo пользователь печатал.
  expect(harness.queue.dirtySync).toBe(true);
  harness.queue.unblock();
  expect(harness.queue.dirtySync).toBe(false);
});

test('plain text commands do not enter the syncing window', async () => {
  const harness = makeQueue();
  harness.delays = [10];
  harness.push(textCommand());
  expect(harness.queue.awaitingSync).toBe(false);
  await harness.queue.idle();
});
