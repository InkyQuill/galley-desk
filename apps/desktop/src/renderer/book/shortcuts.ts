/**
 * Zen toggles from three places (button, menu, keyboard) share this guard.
 * Escape never toggles Zen (it only dismisses top-layer overlays -- popup,
 * flyout, search, ...); the dedicated shortcut is Ctrl+Alt+Z on Linux/Windows
 * and Cmd+Alt+Z on macOS. Matching on `event.code` (not `event.key`) keeps it
 * layout-independent -- KeyZ fires under a Russian layout too. Shift is
 * explicitly excluded so Ctrl/Cmd+Shift+Z (Redo) keeps working untouched.
 */
export function isZenShortcut(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'>,
  platform: NodeJS.Platform,
): boolean {
  return !event.repeat && !event.isComposing && event.code === 'KeyZ'
    && event.altKey && !event.shiftKey
    && (platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

/** Человекочитаемая подпись shortcut'а Zen для подсказки кнопки (Task 10);
 * платформа ещё не пришла (см. BookWindow) -- показываем вариант для Linux/Windows. */
export function zenShortcutLabel(platform: NodeJS.Platform | null): string {
  return platform === 'darwin' ? 'Cmd+Alt+Z' : 'Ctrl+Alt+Z';
}
