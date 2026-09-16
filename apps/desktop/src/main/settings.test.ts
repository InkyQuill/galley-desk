// Bounds and theme-id validation of the appearance settings block (main-side
// validation of untrusted renderer values; the renderer UI clamps too, but
// the contract lives here).
import { describe, expect, test } from 'vitest';
import { DEFAULT_APPEARANCE, validateAppearance } from './settings';

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
});
