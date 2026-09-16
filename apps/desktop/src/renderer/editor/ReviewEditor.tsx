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
import type { MutableRefObject } from 'react';
import type { Command, Snapshot } from '../../shared/api';
import { bookResourceUrl, isLocalImagePath } from '../book/bookres';
import { dispatchRecordMarkers, installMarkerStyles, recordMarkers, subscribeScheme } from './markers';
import { CommandQueue, TypingGroups, fromSnapshot, isHistoryCommand, toTextChanges } from './transaction-adapter';
import '@inkyquill/galley-editor/style.css';

// Значки маркеров правок/сигналов рисуются стилями — один раз на рендерер.
installMarkerStyles();

/** Императивный доступ панели/попапов к FIFO-очереди и геометрии редактора. */
export type ReviewEditorApi = {
  /** Команда через общую FIFO (порядок с вводом сохраняется). */
  enqueue: (command: Command) => void;
  focus: () => void;
  /** Скроллит к записи и выделяет её диапазон; false, если якоря нет. */
  reveal: (recordId: string) => boolean;
  /** Выделяет произвольный диапазон (поиск) и скроллит к нему; false без view. */
  revealRange: (from: number, to: number) => boolean;
  coordsAt: (pos: number) => { top: number; left: number; bottom: number } | null;
};

type Props = {
  snapshot: Snapshot;
  onCommand: (c: Command) => Promise<Snapshot>;
  /** Реальный якорь выделения — уходит в savePosition (контракт Recent). */
  onSelectionChange?: (anchor: number) => void;
  /** Реальный scrollTop скроллера редактора — уходит в savePosition. */
  onScrollChange?: (scrollTop: number) => void;
  /** Восстановление якоря чтения при открытии главы. */
  initialAnchor?: number | null;
  /** Непустое выделение → координаты flyout; схлопывание → null. */
  onSelectionWindow?: (range: { from: number; to: number; x: number; y: number; bottom: number } | null) => void;
  /** Клик по маркеру правки/сигнала (или подстроке комментария). */
  onRecordClick?: (recordId: string, rect: { x: number; y: number; bottom: number }) => void;
  /** Куда SignalFlyout кладёт функцию фокуса для Tab-пути из редактора. */
  flyoutFocusRef?: MutableRefObject<(() => void) | null>;
  /** Выдача ReviewEditorApi (null при демонтаже). */
  onApi?: (api: ReviewEditorApi | null) => void;
};

type ReplacePlan = { kind: 'switch' | 'sync'; chapterId: string; text: string; anchor: number };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Операция не выполнена';
}

export function ReviewEditor({
  snapshot,
  onCommand,
  onSelectionChange,
  onScrollChange,
  initialAnchor = null,
  onSelectionWindow,
  onRecordClick,
  flyoutFocusRef,
  onApi,
}: Props) {
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
  const onSelectionWindowRef = useRef(onSelectionWindow);
  onSelectionWindowRef.current = onSelectionWindow;
  const onRecordClickRef = useRef(onRecordClick);
  onRecordClickRef.current = onRecordClick;
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;
  // Flyout-реф — стабильный объект из BookWindow; фиксируем на случай смены.
  const flyoutFocusPropRef = useRef(flyoutFocusRef);
  flyoutFocusPropRef.current = flyoutFocusRef;
  // Свежие записи для диспетчера украшений и reveal из панели.
  const recordsRef = useRef(snapshot.records);
  recordsRef.current = snapshot.records;

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
      if (queue.blocked) {
        // После сбоя сохранения внешняя версия не принимается молча
        // («авто-затирания нет»): локальный текст, ошибка и блокировка
        // очереди живут до явного выбора пользователя — «Перечитать
        // главу» (пересоздание по epoch) или resolveExternal.
        return;
      }
      queue.unblock();
      setCommandError(null);
    }
    // Авторитетный текст main расходится с локальным документом после команд,
    // меняющих производный текст на main (применение, отклонение/снятие
    // конфликта записи): при пустой очереди документ заменяется снимком.
    // Расхождение из-за непроведённого ввода невозможно — пока ввод не ack'нут,
    // очередь не пуста, а ack'нутый ввод уже есть в snapshot.text.
    if (!queue.blocked && queue.inFlight === 0 && snapshot.saveState !== 'external') {
      const local = handleRef.current?.getContent();
      if (local !== undefined && local !== snapshot.text) {
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
      {
        // Клавиатурный путь к flyout: при непустом выделении Tab уводит фокус
        // в панель выбора типа (копирование/навигация не затронуты); без
        // flyout поведение Tab не меняется.
        key: 'Tab',
        run: () => {
          const selection = handleRef.current?.getSelection();
          const focusFlyout = flyoutFocusPropRef.current?.current ?? null;
          if (focusFlyout === null || selection === undefined || selection.from >= selection.to) return false;
          focusFlyout();
          return true;
        },
      },
    ];
  }
  const extensionsRef = useRef<Extension[] | null>(null);
  if (extensionsRef.current === null) {
    extensionsRef.current = [Prec.highest(keymap.of(sessionKeymapRef.current)), observerRef.current, recordMarkers()];
  }

  // Выделение → окно flyout: непустой диапазон даёт координаты конца выделения,
  // схлопнутое выделение закрывает flyout. Фокус не переносится.
  const handleSelection = useCallback((selection: { anchor: number; head: number; from: number; to: number }): void => {
    onSelectionRef.current?.(selection.anchor);
    if (selection.from < selection.to) {
      const view = handleRef.current?.view ?? null;
      const pos = Math.min(selection.to, view?.state.doc.length ?? selection.to);
      const coords = view !== null ? view.coordsAtPos(pos) : null;
      if (coords !== null) {
        onSelectionWindowRef.current?.({
          from: selection.from,
          to: selection.to,
          x: coords.left,
          y: coords.top,
          bottom: coords.bottom,
        });
        return;
      }
    }
    onSelectionWindowRef.current?.(null);
  }, []);

  // Клик по маркеру правки/сигнала или подстроке комментария (делегирование).
  const handleHostClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    const marker = target?.closest?.('[data-record-id]') ?? null;
    if (marker === null) return;
    const recordId = marker.getAttribute('data-record-id');
    if (recordId === null) return;
    const rect = marker.getBoundingClientRect();
    onRecordClickRef.current?.(recordId, { x: rect.left, y: rect.top, bottom: rect.bottom });
  }, []);

  // Реальный scrollTop скроллера редактора (fraction Galley пересчитывать
  // в пиксели нельзя без потери точности при восстановлении).
  const handleScroll = useCallback((_fraction: number): void => {
    const scroller = hostRef.current?.querySelector('.cm-scroller');
    if (scroller) onScrollRef.current?.(scroller.scrollTop);
  }, []);

  // Императивный API для панели и попапов: объект стабилен, ссылки — через ref.
  const apiRef = useRef<ReviewEditorApi | null>(null);
  if (apiRef.current === null) {
    apiRef.current = {
      enqueue: (command) => enqueueRef.current(command),
      focus: () => handleRef.current?.focus(),
      reveal: (recordId) => {
        const record = recordsRef.current.find((candidate) => candidate.id === recordId);
        const view = handleRef.current?.view ?? null;
        if (record === undefined || record.from === null || record.to === null || view === null) return false;
        const from = Math.max(0, Math.min(record.from, view.state.doc.length));
        const to = Math.max(0, Math.min(record.to, view.state.doc.length));
        view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
        return true;
      },
      revealRange: (from, to) => {
        const view = handleRef.current?.view ?? null;
        if (view === null) return false;
        const length = view.state.doc.length;
        const anchor = Math.max(0, Math.min(from, length));
        const head = Math.max(0, Math.min(to, length));
        view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(head, { y: 'center' }) });
        return true;
      },
      coordsAt: (pos) => {
        const view = handleRef.current?.view ?? null;
        if (view === null) return null;
        const coords = view.coordsAtPos(Math.max(0, Math.min(pos, view.state.doc.length)));
        return coords === null ? null : { top: coords.top, left: coords.left, bottom: coords.bottom };
      },
    };
  }
  useEffect(() => {
    onApiRef.current?.(apiRef.current);
    return () => {
      onApiRef.current?.(null);
    };
  }, []);

  // Украшения маркеров перестраиваются по записям снапшота; пока команды в
  // полёте, существующий набор мапится через изменения документа (в поле).
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const push = (): void => {
      if (cancelled) return;
      const view = handleRef.current?.view ?? null;
      if (view === null) {
        if (++attempts < 120) requestAnimationFrame(push);
        return;
      }
      if (!queue.blocked && queue.inFlight === 0) dispatchRecordMarkers(view, recordsRef.current);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [snapshot.records, queue]);

  // Смена схемы темы оформления (светлый/тёмный набор Pocket-палитры) требует
  // перестроения украшений: подписка перекидывает свежие записи в поле.
  useEffect(
    () =>
      subscribeScheme(() => {
        const view = handleRef.current?.view ?? null;
        if (view === null || queue.blocked || queue.inFlight > 0) return;
        dispatchRecordMarkers(view, recordsRef.current);
      }),
    [queue],
  );

  return (
    <div className="review-editor" ref={hostRef} onClick={handleHostClick}>
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
