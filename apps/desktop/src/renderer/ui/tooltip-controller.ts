// Общий контроллер тем-подсказок (история №7 UX-ревью, Task 10): единственный
// источник истины для ЛЮБОЙ подсказки приложения -- и React-обёртки Tooltip
// (renderer/ui/Tooltip.tsx), и императивных DOM-виджетов редактора (CodeMirror
// не React-дерево, см. attachTooltip и его использование в ComparisonView/
// ReviewEditor). Оба пути показывают ОДИН и тот же themed host (TooltipHost в
// Tooltip.tsx), подписанный на этот стор -- в приложении не может быть двух
// визуально разных систем подсказок.
//
// Модуль не импортирует React (кроме типа ReactNode) -- это чистый TS-стор с
// таймерами и DOM-слушателями, пригодный и для голых HTMLElement, и для React
// через useSyncExternalStore в TooltipHost.
import type { ReactNode } from 'react';

/** id хоста подсказки: один на всё приложение (подсказка всегда одна). */
export const TOOLTIP_ID = 'gd-tooltip';

/** Задержка показа при наведении мышью; фокус показывает сразу (см. showNow). */
const HOVER_DELAY_MS = 300;

export type TooltipSnapshot = {
  visible: boolean;
  rect: DOMRect | null;
  content: ReactNode;
  shortcut: string | undefined;
};

const EMPTY_SNAPSHOT: TooltipSnapshot = { visible: false, rect: null, content: null, shortcut: undefined };

let snapshot: TooltipSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Подписка TooltipHost (useSyncExternalStore) на изменения видимой подсказки. */
export function subscribeTooltip(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTooltipSnapshot(): TooltipSnapshot {
  return snapshot;
}

let showTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTarget: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;

function clearPending(): void {
  if (showTimer !== null) clearTimeout(showTimer);
  showTimer = null;
  pendingTarget = null;
}

/** Добавляет id хоста к существующему aria-describedby, не затирая чужие id. */
function addDescribedBy(target: HTMLElement): void {
  const existing = target.getAttribute('aria-describedby');
  const tokens = existing ? existing.split(/\s+/).filter(Boolean) : [];
  if (!tokens.includes(TOOLTIP_ID)) target.setAttribute('aria-describedby', [...tokens, TOOLTIP_ID].join(' '));
}

/** Снимает только наш id, оставляя остальные значения aria-describedby нетронутыми. */
function removeDescribedBy(target: HTMLElement): void {
  const existing = target.getAttribute('aria-describedby');
  if (!existing) return;
  const tokens = existing.split(/\s+/).filter((token) => token && token !== TOOLTIP_ID);
  if (tokens.length > 0) target.setAttribute('aria-describedby', tokens.join(' '));
  else target.removeAttribute('aria-describedby');
}

function setVisible(target: HTMLElement, content: ReactNode, shortcut: string | undefined): void {
  clearPending();
  activeTarget = target;
  addDescribedBy(target);
  snapshot = { visible: true, rect: target.getBoundingClientRect(), content, shortcut };
  notify();
}

/** Фокус показывает подсказку сразу, без задержки наведения. */
export function showTooltipNow(target: HTMLElement, content: ReactNode, shortcut?: string): void {
  setVisible(target, content, shortcut);
}

/** Наведение мышью показывает подсказку через HOVER_DELAY_MS. */
export function scheduleTooltip(target: HTMLElement, content: ReactNode, shortcut?: string): void {
  clearPending();
  pendingTarget = target;
  showTimer = setTimeout(() => {
    showTimer = null;
    pendingTarget = null;
    setVisible(target, content, shortcut);
  }, HOVER_DELAY_MS);
}

/**
 * Скрывает подсказку и снимает отложенный таймер показа. Без аргумента (Escape,
 * скролл, потеря фокуса окна) гасит вообще всё, что видимо или отложено; с
 * target скрывает/отменяет только если он относится именно к этому target --
 * так уход мыши с одного элемента не гасит уже показанную подсказку другого.
 */
export function hideTooltip(target?: HTMLElement): void {
  if (pendingTarget !== null && (target === undefined || pendingTarget === target)) clearPending();
  if (target !== undefined && activeTarget !== target) return;
  if (activeTarget !== null) {
    removeDescribedBy(activeTarget);
    activeTarget = null;
  }
  if (!snapshot.visible) return;
  snapshot = EMPTY_SNAPSHOT;
  notify();
}

let globalListenersAttached = false;

/** Escape/scroll/blur гасят подсказку глобально -- лениво один раз на приложение. */
function ensureGlobalListeners(): void {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;
  // Bubble-фаза (без capture): верхний обработчик Escape в BookWindow слушает
  // capture-фазу на window и не вызывает stopPropagation для своих переходов
  // (см. renderer/book/BookWindow.tsx, блок "Zen и порядок Escape") -- эта
  // подсказка гасится ПОСЛЕ него и ничего не глушит и не перехватывает.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
  // capture: true -- scroll не всплывает, но нужно поймать прокрутку любого
  // вложенного контейнера (панель глав, список рецензии и т.д.).
  window.addEventListener('scroll', () => hideTooltip(), true);
  window.addEventListener('blur', () => hideTooltip());
}

/**
 * Общая проводка hover/focus для любого HTMLElement -- используется и
 * attachTooltip (голые DOM-виджеты редактора), и Tooltip.tsx (React-обёртка,
 * которая передаёт геттеры вместо статичных значений, чтобы не переустанавливать
 * слушатели при каждом изменении content/shortcut).
 */
export function bindTooltip(
  target: HTMLElement,
  getContent: () => ReactNode,
  getShortcut: () => string | undefined,
): () => void {
  ensureGlobalListeners();
  const onMouseEnter = (): void => scheduleTooltip(target, getContent(), getShortcut());
  const onMouseLeave = (): void => hideTooltip(target);
  const onFocus = (): void => showTooltipNow(target, getContent(), getShortcut());
  const onBlur = (): void => hideTooltip(target);
  target.addEventListener('mouseenter', onMouseEnter);
  target.addEventListener('mouseleave', onMouseLeave);
  target.addEventListener('focus', onFocus);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('mouseenter', onMouseEnter);
    target.removeEventListener('mouseleave', onMouseLeave);
    target.removeEventListener('focus', onFocus);
    target.removeEventListener('blur', onBlur);
    hideTooltip(target);
  };
}

/**
 * Подсказка для императивных DOM-виджетов (не React-дерево): CodeMirror-
 * виджеты редактора и т.п. Content -- обычная строка (в отличие от Tooltip.tsx,
 * где content -- React.ReactNode) -- сам host рендерит и то, и другое одинаково,
 * React умеет рендерить строку как узел.
 */
export function attachTooltip(target: HTMLElement, content: string, shortcut?: string): () => void {
  return bindTooltip(target, () => content, () => shortcut);
}
