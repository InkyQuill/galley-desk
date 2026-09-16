// Appearance and reading-position persistence in the appData directory.
// The renderer's appearance UI persists through these DeskApi methods; main
// validates every value before it reaches the file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isThemeId } from '@inkyquill/galley-themes';
import type { AppearanceSettings } from '../shared/api';

const SETTINGS_FILE = 'settings.json';

export const FONT_SIZE_BOUNDS = { min: 10, max: 48 } as const;
export const LINE_WIDTH_BOUNDS = { min: 320, max: 1600 } as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: 'auto',
  fontFamily: 'Literata',
  fontSize: 18,
  uiFontFamily: 'Geist',
  uiFontSize: 13,
  lineWidth: 700,
};

export type DeskSettings = {
  appearance: AppearanceSettings;
  positions: Record<string, Record<string, { anchor: number; scrollTop: number }>>;
};

/** Validates an untrusted appearance value; numbers keep the plan bounds. */
export function validateAppearance(value: unknown): AppearanceSettings {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Настройки оформления должны быть объектом');
  }
  const record = value as Partial<AppearanceSettings>;
  const themeId = record.themeId;
  const fontFamily = record.fontFamily;
  // Известен либо «auto» (системная схема), либо идентификатор из каталога
  // тем; настройки оформления живут в appData и никогда не попадают в книгу.
  if (typeof themeId !== 'string' || (themeId !== 'auto' && !isThemeId(themeId))) {
    throw new Error('Неизвестный идентификатор темы');
  }
  if (typeof fontFamily !== 'string' || fontFamily.length === 0 || fontFamily.length > 200) {
    throw new Error('Некорректное имя шрифта');
  }
  if (
    typeof record.fontSize !== 'number' ||
    !Number.isSafeInteger(record.fontSize) ||
    record.fontSize < FONT_SIZE_BOUNDS.min ||
    record.fontSize > FONT_SIZE_BOUNDS.max
  ) {
    throw new Error(
      `Размер шрифта должен быть целым числом от ${FONT_SIZE_BOUNDS.min} до ${FONT_SIZE_BOUNDS.max}`,
    );
  }
  if (
    typeof record.lineWidth !== 'number' ||
    !Number.isSafeInteger(record.lineWidth) ||
    record.lineWidth < LINE_WIDTH_BOUNDS.min ||
    record.lineWidth > LINE_WIDTH_BOUNDS.max
  ) {
    throw new Error(
      `Ширина строки должна быть целым числом от ${LINE_WIDTH_BOUNDS.min} до ${LINE_WIDTH_BOUNDS.max}`,
    );
  }
  // Old files did not store separate chrome typography. Preserve every old
  // reading setting and supply defaults only for absent new fields.
  const uiFontFamily = record.uiFontFamily === undefined ? DEFAULT_APPEARANCE.uiFontFamily : record.uiFontFamily;
  const uiFontSize = record.uiFontSize === undefined ? DEFAULT_APPEARANCE.uiFontSize : record.uiFontSize;
  if (typeof uiFontFamily !== 'string' || !uiFontFamily.trim() || uiFontFamily.length > 200) {
    throw new Error('Некорректное имя шрифта интерфейса');
  }
  if (typeof uiFontSize !== 'number' || !Number.isSafeInteger(uiFontSize) || uiFontSize < 10 || uiFontSize > 24) {
    throw new Error('Размер шрифта интерфейса должен быть целым числом от 10 до 24');
  }
  return { themeId, fontFamily, fontSize: record.fontSize, lineWidth: record.lineWidth, uiFontFamily, uiFontSize };
}

/** Loads settings; a missing or corrupt file yields the defaults. */
export async function loadSettings(appData: string): Promise<DeskSettings> {
  let raw: string;
  try {
    raw = await readFile(path.join(appData, SETTINGS_FILE), 'utf8');
  } catch {
    return { appearance: { ...DEFAULT_APPEARANCE }, positions: {} };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { appearance: { ...DEFAULT_APPEARANCE }, positions: {} };
    }
    const record = parsed as Partial<DeskSettings>;
    // Загруженный блок оформления проходит ту же валидацию, что и set:
    // руками отредактированный или повреждённый файл откатывает блок целиком
    // к значениям по умолчанию (позиции чтения при этом сохраняются).
    let appearance: AppearanceSettings;
    try {
      appearance = validateAppearance(record.appearance);
    } catch {
      appearance = { ...DEFAULT_APPEARANCE };
    }
    const positions = positionsFrom(record.positions);
    return { appearance, positions };
  } catch {
    return { appearance: { ...DEFAULT_APPEARANCE }, positions: {} };
  }
}

/** Persists the appearance block atomically, keeping positions intact. */
export async function saveAppearance(appData: string, value: AppearanceSettings): Promise<void> {
  const settings = await loadSettings(appData);
  await writeSettings(appData, { ...settings, appearance: value });
}

/** Stores the reading position of one chapter keyed by the stable book id. */
export async function savePosition(
  appData: string,
  bookId: string,
  chapterId: string,
  anchor: number,
  scrollTop: number,
): Promise<void> {
  const settings = await loadSettings(appData);
  const bookPositions = { ...(settings.positions[bookId] ?? {}) };
  bookPositions[chapterId] = { anchor, scrollTop };
  await writeSettings(appData, { ...settings, positions: { ...settings.positions, [bookId]: bookPositions } });
}

async function writeSettings(appData: string, settings: DeskSettings): Promise<void> {
  await mkdir(appData, { recursive: true });
  const target = path.join(appData, SETTINGS_FILE);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(temp, target);
}

function positionsFrom(value: unknown): DeskSettings['positions'] {
  const result: DeskSettings['positions'] = {};
  if (typeof value !== 'object' || value === null) return result;
  for (const [bookId, chapters] of Object.entries(value as Record<string, unknown>)) {
    if (typeof chapters !== 'object' || chapters === null) continue;
    for (const [chapterId, position] of Object.entries(chapters as Record<string, unknown>)) {
      if (typeof position !== 'object' || position === null) continue;
      const record = position as { anchor?: unknown; scrollTop?: unknown };
      if (typeof record.anchor !== 'number' || typeof record.scrollTop !== 'number') continue;
      if (!Number.isSafeInteger(record.anchor) || record.anchor < 0) continue;
      if (!Number.isSafeInteger(record.scrollTop) || record.scrollTop < 0) continue;
      (result[bookId] ??= {})[chapterId] = { anchor: record.anchor, scrollTop: record.scrollTop };
    }
  }
  return result;
}
