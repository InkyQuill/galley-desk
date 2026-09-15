// ReviewEditor: один экземпляр Galley на главу, связывающий транзакции
// редактора с сессией рецензирования через desk.command.
//
// Ключевые решения:
// - Единственный экземпляр Galley живёт всё время главы; все callbacks,
//   переданные компоненту, стабильны (состояние — в ref), поэтому React не
//   пересоздаёт редактор и не сбрасывает курсор/IME.
// - value-проп передаётся в Galley только как точная копия текущего
//   документа: авторитетные замены (внешняя версия, undo/redo, смена главы)
//   dispatch'атся напрямую во view с аннотацией fromSnapshot, а value
//   обновляется следом — синхронизация Galley на пассивном эффекте видит
//   равенство и не трогает документ. Курсор и IME-композиция не сбрасываются.
// - Пользовательские транзакции уходят в main строго FIFO (CommandQueue);
//   ack обновляет записи/статус сохранения, но никогда не подменяет документ.
// - После сбоя команды локальный текст сохраняется, показывается ошибка,
//   отправки блокируются до ресинхронизации (замена документа/смена главы).
// - Undo/redo в «Тексте» маршрутизируются в сессию (undo-input/redo-input);
//   вне редактора нативный undo полей не затрагивается.
import { Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { GalleyEditor } from '@inkyquill/galley-editor';
import type { GalleyHandle, GalleyImageInfo } from '@inkyquill/galley-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, Snapshot } from '../../shared/api';
import { bookResourceUrl, isLocalImagePath } from '../book/bookres';
import { CommandQueue, TypingGroups, fromSnapshot, isHistoryCommand, toTextChanges } from './transaction-adapter';
import '@inkyquill/galley-editor/style.css';

type Props = {
  snapshot: Snapshot;
  onCommand: (c: Command) => Promise<Snapshot>;
  /** Реальный якорь выделения — уходит в savePosition (контракт Recent). */
  onSelectionChange?: (anchor: number) => void;
  /** Реальный scrollTop скроллера редактора — уходит в savePosition. */
  onScrollChange?: (scrollTop: number) => void;
  /** Восстановление якоря чтения при открытии главы. */
  initialAnchor?: number | null;
};

type ReplacePlan = { kind: 'switch' | 'sync'; chapterId: string; text: string; anchor: number };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Операция не выполнена';
}

export function ReviewEditor({ snapshot, onCommand, onSelectionChange, onScrollChange, initialAnchor = null }: Props) {
  const handleRef = useRef<GalleyHandle | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const groupsRef = useRef(new TypingGroups());
  const pendingRef = useRef<ReplacePlan | null>(null);
  const stateRef = useRef({
    chapterId: '',
    expectedRevision: 0,
    mounted: false,
  });

  // Транспорт и контекст фиксируются в момент постановки команды в очередь:
  // смена главы не перепривязывает уже поставленные команды к новой главе.
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onSelectionRef = useRef(onSelectionChange);
  onSelectionRef.current = onSelectionChange;
  const onScrollRef = useRef(onScrollChange);
  onScrollRef.current = onScrollChange;

  const setDocRef = useRef<((value: { chapterId: string; text: string }) => void) | null>(null);
  const setCommandErrorRef = useRef<((value: string | null) => void) | null>(null);
  const [doc, setDoc] = useState(() => ({ chapterId: snapshot.chapterId, text: snapshot.text }));
  const [commandError, setCommandError] = useState<string | null>(null);
  setDocRef.current = setDoc;
  setCommandErrorRef.current = setCommandError;

  const queueRef = useRef<CommandQueue<Snapshot, string> | null>(null);
  if (queueRef.current === null) {
    queueRef.current = new CommandQueue<Snapshot, string>({
      onAck: (ack, command, context) => {
        if (stateRef.current.chapterId !== context) return;
        stateRef.current.expectedRevision = Math.max(stateRef.current.expectedRevision, ack.revision);
        // Документ замещается только по undo/redo, когда очередь пуста и
        // пользователь не печатал во время полёта: иначе локальный ввод
        // новее ack'а и затирать его нельзя.
        if (isHistoryCommand(command) && queueRef.current?.inFlight === 0 && !queueRef.current.dirtySync) {
          const anchor = handleRef.current?.getSelection().anchor ?? 0;
          requestReplaceRef.current('sync', context, ack.text, anchor);
        }
      },
      onError: (error, _command, context) => {
        if (stateRef.current.chapterId !== context) return;
        // Локальный текст сохраняется; отправки блокируются до ресинхронизации.
        setCommandErrorRef.current?.(`${errorText(error)} — локальный текст сохранён, перечитайте главу`);
      },
    });
  }
  const queue = queueRef.current;

  /** Помечает документ к замене и применяет план, если сейчас можно. */
  function requestReplace(kind: 'switch' | 'sync', chapterId: string, text: string, anchor: number | null): void {
    pendingRef.current = { kind, chapterId, text, anchor: anchor ?? 0 };
    const view = handleRef.current?.view;
    if (view) applyPending(view);
  }
  const requestReplaceRef = useRef(requestReplace);
  requestReplaceRef.current = requestReplace;

  /**
   * Применяет отложенную замену документа с аннотацией fromSnapshot.
   * Во время IME-композиции замена откладывается (до композиции), устаревшие
   * планы отбрасываются. Пока очередь непуста, sync-замены запрещены:
   * снимок старе локальной работы не подменяет документ.
   */
  function applyPending(view: EditorView): void {
    const pending = pendingRef.current;
    if (pending === null) return;
    if (view.composing) return;
    if (stateRef.current.chapterId !== pending.chapterId) {
      pendingRef.current = null;
      return;
    }
    if (pending.kind === 'sync' && ((queue.inFlight > 0) || queue.blocked)) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    groupsRef.current.reset();
    // Якорь ограничивается длиной нового текста: вне диапазона dispatch падает.
    const anchor = Math.max(0, Math.min(pending.anchor, pending.text.length));
    if (view.state.doc.toString() !== pending.text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: pending.text },
        selection: { anchor, head: anchor },
        annotations: fromSnapshot.of(true),
      });
    } else if (pending.anchor > 0) {
      view.dispatch({ selection: { anchor, head: anchor } });
    }
    setDocRef.current?.({ chapterId: pending.chapterId, text: pending.text });
  }
  const applyPendingRef = useRef(applyPending);
  applyPendingRef.current = applyPending;

  /** Ставит пользовательскую команду в FIFO; транспорт — на момент вызова. */
  function enqueue(command: Command): void {
    if (queue.blocked) return;
    const chapterId = stateRef.current.chapterId;
    const transport = onCommandRef.current;
    queue.push(command, () => transport(command), chapterId);
  }
  const enqueueRef = useRef(enqueue);
  enqueueRef.current = enqueue;

  // Наблюдатель Galley создаётся один раз: пользовательские транзакции →
  // команды, авторитетные замены (fromSnapshot) никогда не возвращаются.
  const observerRef = useRef<Extension | null>(null);
  if (observerRef.current === null) {
    observerRef.current = EditorView.updateListener.of((update) => {
      const view = update.view;
      if (pendingRef.current !== null && !view.composing) applyPendingRef.current(view);
      if (!update.docChanged) {
        // Смена выделения без изменения текста разрывает пачку набора.
        if (update.selectionSet) groupsRef.current.reset();
        return;
      }
      for (const tr of update.transactions) {
        const changes = toTextChanges(tr);
        // Пусто для fromSnapshot-замен и смены выделения.
        if (changes.length === 0 || !stateRef.current.mounted) continue;
        if (queueRef.current?.awaitingSync) queueRef.current.markDirty();
        const selection = view.state.selection.main;
        const command: Command = {
          type: 'text',
          changes,
          selection: { anchor: selection.anchor, head: selection.head },
          group:
            changes.length === 1
              ? groupsRef.current.next(changes[0]!, view.composing)
              : groupsRef.current.fresh(),
        };
        enqueueRef.current(command);
      }
    });
  }

  // Ресинхронизация по снапшотам: смена главы — замена всегда; та же глава
  // с более новой ревизией — замена только при пустой очереди (пока очередь
  // непуста, документ не заменяется более старым снимком).
  useEffect(() => {
    const state = stateRef.current;
    if (state.chapterId !== snapshot.chapterId) {
      state.chapterId = snapshot.chapterId;
      state.expectedRevision = snapshot.revision;
      state.mounted = true;
      queue.unblock();
      setCommandError(null);
      groupsRef.current.reset();
      requestReplace('switch', snapshot.chapterId, snapshot.text, initialAnchor ?? 0);
      return;
    }
    if (!state.mounted) {
      state.mounted = true;
      state.expectedRevision = snapshot.revision;
      return;
    }
    if (snapshot.revision > state.expectedRevision) {
      state.expectedRevision = snapshot.revision;
      queue.unblock();
      setCommandError(null);
      if (queue.inFlight === 0 && snapshot.saveState !== 'external') {
        const anchor = Math.min(handleRef.current?.getSelection().anchor ?? 0, snapshot.text.length);
        requestReplace('sync', snapshot.chapterId, snapshot.text, anchor);
      }
    }
    // initialAnchor сознательно вне зависимостей: якорь восстанавливается
    // один раз, при смене главы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // Локальные картинки — через защищённую схему bookres; чужие схемы и
  // обход каталогов рендерятся как недоступные, не как bookres-ссылки.
  const imageRendererRef = useRef<(image: GalleyImageInfo) => HTMLElement | null>(() => null);
  imageRendererRef.current = (image) => {
    if (!isLocalImagePath(image.url)) {
      const placeholder = document.createElement('span');
      placeholder.className = 'book__image-unavailable';
      placeholder.textContent = image.alt;
      return placeholder;
    }
    const element = document.createElement('img');
    element.className = 'book__image';
    element.src = bookResourceUrl(snapshot.bookId, image.url);
    element.alt = image.alt;
    element.title = image.url;
    return element;
  };
  const imageRenderer = useCallback(
    (image: GalleyImageInfo) => imageRendererRef.current(image),
    [],
  );

  // Undo/redo в «Тексте» — команды сессии. Prec.highest обязателен: ключ
  // биндинга Galley (historyKeymap CodeMirror) перебивал бы наш по порядку
  // расширений, и ввод уходил бы в локальную историю редактора вместо main.
  const sessionUndo = useCallback(() => {
    enqueueRef.current({ type: 'undo-input' });
    return true;
  }, []);
  const sessionRedo = useCallback(() => {
    enqueueRef.current({ type: 'redo-input' });
    return true;
  }, []);
  const sessionKeymapRef = useRef<KeyBinding[] | null>(null);
  if (sessionKeymapRef.current === null) {
    sessionKeymapRef.current = [
      { key: 'Mod-z', run: sessionUndo },
      // CM различает регистр при Shift: событие приходит как 'Z'.
      { key: 'Mod-Shift-z', run: sessionRedo },
      { key: 'Mod-Shift-Z', run: sessionRedo },
      { key: 'Mod-y', run: sessionRedo },
    ];
  }
  const extensionsRef = useRef<Extension[] | null>(null);
  if (extensionsRef.current === null) {
    extensionsRef.current = [
      Prec.highest(keymap.of(sessionKeymapRef.current)),
      observerRef.current,
    ];
  }

  const handleSelection = useCallback((selection: { anchor: number }): void => {
    onSelectionRef.current?.(selection.anchor);
  }, []);

  // Реальный scrollTop скроллера редактора (fraction Galley пересчитывать
  // в пиксели нельзя без потери точности при восстановлении).
  const handleScroll = useCallback((_fraction: number): void => {
    const scroller = hostRef.current?.querySelector('.cm-scroller');
    if (scroller) onScrollRef.current?.(scroller.scrollTop);
  }, []);

  return (
    <div className="review-editor" ref={hostRef}>
      {commandError !== null && (
        <p className="app__error" role="alert">
          {commandError}
        </p>
      )}
      <GalleyEditor
        ref={handleRef}
        value={doc.text}
        docKey="galley-desk-review"
        ariaLabel="Текст главы"
        layout="fill"
        toolbar={false}
        footer={false}
        extensions={extensionsRef.current ?? undefined}
        imageRenderer={imageRenderer}
        onSelectionChange={handleSelection}
        onScroll={handleScroll}
      />
    </div>
  );
}
