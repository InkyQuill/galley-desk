// Мост между CodeMirror-транзакциями Galley и сессией главы.
//
// Galley отдаёт позиции и транзакции в UTF-16 своего Markdown-документа
// (спецификация §8, ADR-2); канонизацию в байты исходника выполняет движок
// (C3/C6). Здесь только два преобразования:
//
// 1) `toTextChanges` — транзакция → TextChange[] для команды `text`;
// 2) `fromSnapshot` — аннотация авторитетных замен документа (внешняя версия,
//    undo/redo, смена главы). Замена, помеченная этой аннотацией, никогда не
//    возвращается наверх как правка пользователя — иначе она ушла бы в main
//    как обычный ввод и зациклила сохранение.
//
// Группы ввода (undo-шаги). В renderer живёт простая эвристика: текущая
// группа (`TypingGroups`) переиспользуется, пока новая текстовая команда
// следует за предыдущей не позже GROUP_IDLE_MS и её точка вставки совпадает
// с краем предыдущей вставки (непрерывный набор); в остальных случаях,
// при любой нетекстовой команде и при смене выделения группа сбрасывается
// и создаётся новая (crypto.randomUUID). IME-композиция — всегда одна
// группа, независимо от пауз. Эвристика влияет только на гранулярность
// сессионного undo (InputHistory), ничего не персистит и потому безопасна.
//
// `CommandQueue` — FIFO отправки команд в main: транзакции набора уходят
// строго по порядку, ack обновляет снапшот, сбой сохраняет локальный текст
// и блокирует дальнейшие отправки до ресинхронизации главы.
import { Annotation } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import type { Command } from '../../shared/api';

/** Аннотация авторитетной замены документа (снапшот main, а не ввод). */
export const fromSnapshot = Annotation.define<boolean>();

export function toTextChanges(tr: Transaction) {
  const result: {from:number;to:number;insert:string}[] = [];
  if (tr.annotation(fromSnapshot)) return result;
  tr.changes.iterChanges((from,to,_a,_b,text) => result.push({from,to,insert:text.toString()}));
  return result;
}

// --- Группы ввода -------------------------------------------------------------

/** Пауза, после которой непрерывный набор считается новой пачкой. */
export const GROUP_IDLE_MS = 700;

/**
 * Renderer-side эвристика ключей групп для `edit(..., group)` (контракт C4):
 * подряд идущие символы одной пачки сливаются в один undo-шаг сессии.
 * Часы и генератор id инъецируются для тестов; в приложении — Date.now и
 * crypto.randomUUID.
 */
export class TypingGroups {
  private group: string | null = null;
  private lastEdge: number | null = null;
  private lastAt = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly mint: () => string = () => crypto.randomUUID(),
  ) {}

  /** Ключ группы для текстовой команды с одним изменением. */
  next(change: { from: number; insert: string }, composing: boolean): string {
    if (composing) {
      // Вся IME-композиция — один undo-шаг, независимо от пауз между событиями.
      const composed = this.group ?? this.mint();
      this.group = composed;
      return composed;
    }
    const edge = change.from + change.insert.length;
    const contiguous =
      this.group !== null &&
      this.lastEdge === change.from &&
      this.now() - this.lastAt <= GROUP_IDLE_MS;
    if (contiguous && this.group !== null) {
      this.lastEdge = edge;
      this.lastAt = this.now();
      return this.group;
    }
    this.group = this.mint();
    this.lastEdge = edge;
    this.lastAt = this.now();
    return this.group;
  }

  /** Свежая группа для составной транзакции (вставка, автозамена). */
  fresh(): string {
    this.group = this.mint();
    this.lastEdge = null;
    this.lastAt = this.now();
    return this.group;
  }

  /** Сброс группы: смена выделения или нетекстовая команда разрывают пачку. */
  reset(): void {
    this.group = null;
    this.lastEdge = null;
  }
}

// --- FIFO-очередь команд ------------------------------------------------------

/** История ввода выполняется отдельным undo-шагом сессии, а не текстом. */
export function isHistoryCommand(command: Command): boolean {
  return (
    command.type === 'undo-input' ||
    command.type === 'redo-input' ||
    command.type === 'undo-apply' ||
    command.type === 'redo-apply'
  );
}

export type QueueHost<Ack, Context> = {
  /** Ack успешно применённой команды (снапшот main). */
  onAck: (ack: Ack, command: Command, context: Context) => void;
  /** Отказ команды: локальный текст сохраняется, очередь блокируется. */
  onError: (error: unknown, command: Command, context: Context) => void;
};

/**
 * Строгий FIFO команд в main (50 быстрых транзакций не теряются и не
 * дублируются даже при задержанных ack). Транспорт и контекст (глава,
 * из которой ушла команда) фиксируются в момент постановки в очередь,
 * поэтому смена главы не перепривязывает поставленные команды. После сбоя
 * очередь блокируется: дальнейший ввод остаётся только локально, до
 * ресинхронизации главы.
 */
export class CommandQueue<Ack, Context = unknown> {
  private chain: Promise<void> = Promise.resolve();
  private count = 0;
  private isBlocked = false;
  private isSyncing = false;
  private isDirtySync = false;

  constructor(private readonly host: QueueHost<Ack, Context>) {}

  /** Непроведённых команд (в полёте и в очереди). */
  get inFlight(): number {
    return this.count;
  }

  /** true после сбоя: отправки приостановлены до {@linkcode unblock}. */
  get blocked(): boolean {
    return this.isBlocked;
  }

  /** В полёте команда истории (undo/redo) — окно синхронизации документа. */
  get awaitingSync(): boolean {
    return this.isSyncing;
  }

  /** Пользователь печатал, пока команда истории была в полёте. */
  get dirtySync(): boolean {
    return this.isDirtySync;
  }

  /** Пользовательский ввод во время undo/redo отменяет замену по ack. */
  markDirty(): void {
    if (this.isSyncing) this.isDirtySync = true;
  }

  /** Разблокировка после успешной ресинхронизации (замена документа, глава). */
  unblock(): void {
    this.isBlocked = false;
    this.isDirtySync = false;
  }

  /** Ставит команду в конец очереди; transport и контекст фиксируются сразу. */
  push(command: Command, transport: (command: Command) => Promise<Ack>, context: Context): void {
    if (this.isBlocked) return;
    this.count += 1;
    this.isSyncing = isHistoryCommand(command);
    if (this.isSyncing) this.isDirtySync = false;
    this.chain = this.chain
      .then(() => transport(command))
      .then(
        (ack) => {
          this.count -= 1;
          this.isSyncing = false;
          this.host.onAck(ack, command, context);
        },
        (error: unknown) => {
          this.count -= 1;
          this.isSyncing = false;
          this.isBlocked = true;
          this.host.onError(error, command, context);
        },
      );
  }

  /** Promise, который разрешается, когда очередь полностью опустела. */
  idle(): Promise<void> {
    const done = this.chain;
    return done.then(() => {
      return this.count === 0 ? undefined : this.idle();
    });
  }
}
