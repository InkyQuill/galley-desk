// Юнит-тесты чистых функций схемы: резолв «Системной» темы по известной
// схеме ОС (fake matchMedia вместо окна) и подписка на живую смену схемы.
import { afterEach, expect, test } from 'vitest';
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from '@inkyquill/galley-themes';
import {
  SYSTEM_THEME_ID,
  resolveTheme,
  resolveThemeForScheme,
  subscribeSystemScheme,
  systemSchemeDark,
} from './Appearance';

type ChangeEvent = { matches: boolean };

/** Fake window.matchMedia: один query, слушатели и ручная доставка события. */
function installFakeMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: ChangeEvent) => void>();
  const query = {
    matches: initialMatches,
    addEventListener: (_type: 'change', listener: (event: ChangeEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: (event: ChangeEvent) => void) => {
      listeners.delete(listener);
    },
  };
  const fakeWindow = {
    matchMedia: (queryText: string) => {
      if (queryText !== '(prefers-color-scheme: dark)') throw new Error(`unexpected query: ${queryText}`);
      return query;
    },
  };
  (globalThis as { window?: unknown }).window = fakeWindow;
  return {
    fire(matches: boolean): void {
      query.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test('resolveThemeForScheme: «Системная» и неизвестный id следуют известной схеме', () => {
  expect(resolveThemeForScheme(SYSTEM_THEME_ID, true).id).toBe(DEFAULT_DARK_THEME_ID);
  expect(resolveThemeForScheme(SYSTEM_THEME_ID, false).id).toBe(DEFAULT_LIGHT_THEME_ID);
  expect(resolveThemeForScheme('неизвестная-тема', true).id).toBe(DEFAULT_DARK_THEME_ID);
  expect(resolveThemeForScheme('неизвестная-тема', false).id).toBe(DEFAULT_LIGHT_THEME_ID);
});

test('resolveThemeForScheme: явная тема не зависит от схемы ОС', () => {
  expect(resolveThemeForScheme('galley-light', true).id).toBe('galley-light');
  expect(resolveThemeForScheme('galley-dark', false).id).toBe('galley-dark');
});

test('resolveTheme/systemSchemeDark: живой matchMedia решает текущую схему', () => {
  const fake = installFakeMatchMedia(false);
  expect(systemSchemeDark()).toBe(false);
  expect(resolveTheme(SYSTEM_THEME_ID).id).toBe(DEFAULT_LIGHT_THEME_ID);
  fake.fire(true);
  expect(systemSchemeDark()).toBe(true);
  expect(resolveTheme(SYSTEM_THEME_ID).id).toBe(DEFAULT_DARK_THEME_ID);
});

test('systemSchemeDark: без окна — светлая схема (как раньше в SSR-подобной среде)', () => {
  expect(systemSchemeDark()).toBe(false);
  expect(resolveTheme(SYSTEM_THEME_ID).id).toBe(DEFAULT_LIGHT_THEME_ID);
});

test('subscribeSystemScheme: доставка смены схемы и честная отписка', () => {
  const fake = installFakeMatchMedia(false);
  const seen: boolean[] = [];
  const unsubscribe = subscribeSystemScheme((dark) => seen.push(dark));
  expect(fake.listenerCount()).toBe(1);
  fake.fire(true);
  fake.fire(false);
  unsubscribe();
  expect(seen).toEqual([true, false]);
  expect(fake.listenerCount()).toBe(0);
});

test('subscribeSystemScheme: без окна подписка безопасно отсутствует', () => {
  const seen: boolean[] = [];
  const unsubscribe = subscribeSystemScheme((dark) => seen.push(dark));
  expect(() => unsubscribe()).not.toThrow();
  expect(seen).toEqual([]);
});
