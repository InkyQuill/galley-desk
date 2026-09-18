// Bounds and theme-id validation of the appearance settings block (main-side
// validation of untrusted renderer values; the renderer UI clamps too, but
// the contract lives here). The load path validates the stored block the
// same way: a hand-edited or partially corrupt file falls back to defaults.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_LAYOUT, SIDEBAR_BOUNDS } from '../shared/layout';
import {
  DEFAULT_APPEARANCE,
  loadSettings,
  saveAppearance,
  saveLayout,
  savePosition,
  validateAppearance,
  validateLayout,
} from './settings';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const valid = { ...DEFAULT_APPEARANCE, themeId: 'galley-dark' };

describe('validateAppearance', () => {
  test('принимает значения в границах и известную тему', () => {
    expect(validateAppearance(valid)).toEqual(valid);
    expect(validateAppearance({ ...valid, fontSize: 10, lineWidth: 320 })).toEqual({
      ...valid,
      fontSize: 10,
      lineWidth: 320,
    });
    expect(validateAppearance({ ...valid, fontSize: 48, lineWidth: 1600 })).toEqual({
      ...valid,
      fontSize: 48,
      lineWidth: 1600,
    });
    // «auto» — системная тема, не встроенный идентификатор каталога.
    expect(validateAppearance({ ...DEFAULT_APPEARANCE }).themeId).toBe('auto');
  });

  test('отвергает границы и нечисловые значения', () => {
    expect(() => validateAppearance({ ...valid, fontSize: 9 })).toThrow(/Размер шрифта/);
    expect(() => validateAppearance({ ...valid, fontSize: 49 })).toThrow(/Размер шрифта/);
    expect(() => validateAppearance({ ...valid, fontSize: Number.NaN })).toThrow(/Размер шрифта/);
    expect(() => validateAppearance({ ...valid, fontSize: 16.5 })).toThrow(/Размер шрифта/);
    expect(() => validateAppearance({ ...valid, lineWidth: 319 })).toThrow(/Ширина строки/);
    expect(() => validateAppearance({ ...valid, lineWidth: 1601 })).toThrow(/Ширина строки/);
    expect(() => validateAppearance({ ...valid, lineWidth: Number.POSITIVE_INFINITY })).toThrow(/Ширина строки/);
    expect(() => validateAppearance({ ...valid, fontFamily: '' })).toThrow(/шрифта/);
  });

  test('отвергает неизвестный идентификатор темы', () => {
    expect(() => validateAppearance({ ...valid, themeId: 'night' })).toThrow(/темы/);
    expect(() => validateAppearance({ ...valid, themeId: '' })).toThrow(/темы/);
    expect(() => validateAppearance({ ...valid, themeId: 'galley-dark ' })).toThrow(/темы/);
  });

  test('loadSettings отбрасывает невалидный сохранённый блок к значениям по умолчанию', async () => {
    const appData = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
    // Руками отредактированный файл: fontSize вне границ — блок целиком
    // заменяется на дефолты, а не применяется «как есть».
    await writeFile(
      path.join(appData, 'settings.json'),
      JSON.stringify({
        appearance: { themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 999, lineWidth: 720 },
        positions: {},
      }),
      'utf8',
    );
    const settings = await loadSettings(appData);
    expect(settings.appearance).toEqual(DEFAULT_APPEARANCE);

    // Неизвестная тема в хранилище — тот же откат.
    await writeFile(
      path.join(appData, 'settings.json'),
      JSON.stringify({
        appearance: { themeId: 'night', fontFamily: 'Lora', fontSize: 16, lineWidth: 720 },
        positions: { book: { chapter: { anchor: 1, scrollTop: 2 } } },
      }),
      'utf8',
    );
    const after = await loadSettings(appData);
    expect(after.appearance).toEqual(DEFAULT_APPEARANCE);
    // Позиции чтения при этом сохраняются: отбрасывается только блок оформления.
    expect(after.positions.book?.chapter).toEqual({ anchor: 1, scrollTop: 2 });
  });
});


test('legacy appearance preserves book typography, width, theme and positions', async () => {
  const appData = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
  const legacy = { themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 23, lineWidth: 940 };
  await writeFile(path.join(appData, 'settings.json'), JSON.stringify({ appearance: legacy, positions: { b: { c: { anchor: 4, scrollTop: 9 } } } }));
  const settings = await loadSettings(appData);
  expect(settings.appearance).toEqual({ ...legacy, uiFontFamily: 'Geist', uiFontSize: 13 });
  expect(settings.positions.b?.c).toEqual({ anchor: 4, scrollTop: 9 });
});

test('UI typography validates independently from reading typography', () => {
  expect(validateAppearance({ ...valid, uiFontFamily: 'Arial', uiFontSize: 15, fontSize: 32 })).toEqual({ ...valid, uiFontFamily: 'Arial', uiFontSize: 15, fontSize: 32 });
  for (const uiFontSize of [9, 25, 13.5, NaN]) expect(() => validateAppearance({ ...valid, uiFontSize })).toThrow();
  expect(() => validateAppearance({ ...valid, uiFontFamily: '' })).toThrow();
});

describe('layout settings', () => {
  test('missing and legacy settings use layout defaults without losing other blocks', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
    expect((await loadSettings(empty)).layout).toEqual(DEFAULT_LAYOUT);

    const legacy = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
    await writeFile(path.join(legacy, 'settings.json'), JSON.stringify({
      appearance: valid,
      positions: { book: { chapter: { anchor: 7, scrollTop: 90 } } },
    }));
    const loaded = await loadSettings(legacy);
    expect(loaded.layout).toEqual(DEFAULT_LAYOUT);
    expect(loaded.appearance).toEqual(valid);
    expect(loaded.positions.book?.chapter).toEqual({ anchor: 7, scrollTop: 90 });
  });

  test('validates integral widths inside the inclusive sidebar bounds', () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
    expect(validateLayout({ chaptersWidth: SIDEBAR_BOUNDS.min, reviewWidth: SIDEBAR_BOUNDS.max }))
      .toEqual({ chaptersWidth: 240, reviewWidth: 560 });
    for (const value of [
      { chaptersWidth: 239, reviewWidth: 336 },
      { chaptersWidth: 561, reviewWidth: 336 },
      { chaptersWidth: 315.5, reviewWidth: 336 },
      { chaptersWidth: 315, reviewWidth: Number.NaN },
      { chaptersWidth: 315, reviewWidth: Number.POSITIVE_INFINITY },
    ]) expect(() => validateLayout(value)).toThrow(/ширин/i);
  });

  test('persists layout across a reload', async () => {
    const appData = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
    await saveLayout(appData, { chaptersWidth: 400, reviewWidth: 360 });
    expect((await loadSettings(appData)).layout).toEqual({ chaptersWidth: 400, reviewWidth: 360 });
  });

  test('serializes complete read-modify-write updates from all settings writers', async () => {
    const appData = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
    await writeFile(path.join(appData, 'settings.json'), JSON.stringify({
      appearance: DEFAULT_APPEARANCE, positions: {}, layout: DEFAULT_LAYOUT,
    }));
    const originalRead = vi.mocked(readFile);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstReadStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstReadStarted = resolve; });
    originalRead.mockImplementationOnce(async (...args) => {
      firstReadStarted();
      await gate;
      return (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readFile(...args);
    });

    const appearance = { ...DEFAULT_APPEARANCE, fontSize: 20 };
    const layoutSave = saveLayout(appData, { chaptersWidth: 400, reviewWidth: 360 });
    await started;
    const otherSaves = Promise.all([
      saveAppearance(appData, appearance),
      savePosition(appData, 'book', 'chapter', 12, 340),
    ]);
    release();
    await Promise.all([layoutSave, otherSaves]);

    const saved = await loadSettings(appData);
    expect(saved.layout).toEqual({ chaptersWidth: 400, reviewWidth: 360 });
    expect(saved.appearance).toEqual(appearance);
    expect(saved.positions.book?.chapter).toEqual({ anchor: 12, scrollTop: 340 });
  });

  test('a failed settings write does not poison later saves for the profile', async () => {
    const appData = await mkdtemp(path.join(tmpdir(), 'galley-settings-'));
    await rm(appData, { recursive: true });
    await writeFile(appData, 'blocks mkdir');
    await expect(saveLayout(appData, { chaptersWidth: 400, reviewWidth: 360 })).rejects.toThrow();
    await rm(appData);
    await saveAppearance(appData, { ...DEFAULT_APPEARANCE, fontSize: 21 });
    expect((await loadSettings(appData)).appearance.fontSize).toBe(21);
  });
});
