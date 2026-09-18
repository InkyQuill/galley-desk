import { expect, test } from 'vitest';
import { matchesChapter } from './chapter-filter';

test('matches by title, case-insensitively', () => {
  expect(matchesChapter({ title: 'Глава первая', path: 'chapters/01.md' }, 'первая')).toBe(true);
  expect(matchesChapter({ title: 'Глава первая', path: 'chapters/01.md' }, 'ПЕРВАЯ')).toBe(true);
  expect(matchesChapter({ title: 'Глава первая', path: 'chapters/01.md' }, 'вторая')).toBe(false);
});

test('matches by path when the title does not contain the query', () => {
  expect(matchesChapter({ title: 'Заголовок', path: 'chapters/medved.md' }, 'medved')).toBe(true);
  expect(matchesChapter({ title: 'Заголовок', path: 'chapters/medved.md' }, 'MEDVED')).toBe(true);
});

test('trims surrounding whitespace from the query', () => {
  expect(matchesChapter({ title: 'Кит', path: 'chapters/02.md' }, '  кит  ')).toBe(true);
  expect(matchesChapter({ title: 'Кит', path: 'chapters/02.md' }, '   ')).toBe(true);
});

test('matches purely numeric fragments in the path or title', () => {
  expect(matchesChapter({ title: 'Заголовок', path: 'chapters/012-heading.md' }, '012')).toBe(true);
  expect(matchesChapter({ title: 'Глава 5', path: 'chapters/heading.md' }, '5')).toBe(true);
  expect(matchesChapter({ title: 'Глава 5', path: 'chapters/heading.md' }, '6')).toBe(false);
});

test('empty query matches everything, including a missing title', () => {
  expect(matchesChapter({ title: '', path: 'chapters/03.md' }, '')).toBe(true);
  expect(matchesChapter({ title: 'Что-нибудь', path: 'chapters/04.md' }, '')).toBe(true);
});

test('falls back to matching by path when the title is empty', () => {
  expect(matchesChapter({ title: '', path: 'chapters/vydra.md' }, 'выдра')).toBe(false);
  expect(matchesChapter({ title: '', path: 'chapters/vydra.md' }, 'vydra')).toBe(true);
});

test('no match returns false', () => {
  expect(matchesChapter({ title: 'Ёж', path: 'chapters/ezh.md' }, 'выдра')).toBe(false);
});
