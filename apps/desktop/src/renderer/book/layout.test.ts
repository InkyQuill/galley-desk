import { expect, test } from 'vitest';
import { DEFAULT_LAYOUT } from '../../shared/layout';
import { fitLayout } from './layout';

test('keeps preferred widths when the center has enough room', () => {
  expect(fitLayout(DEFAULT_LAYOUT, 1920)).toEqual({
    chaptersWidth: 315,
    reviewWidth: 336,
    chaptersCollapsed: false,
    reviewCollapsed: false,
  });
});

test('shrinks both visible sidebars while preserving a 480px center', () => {
  const fitted = fitLayout(DEFAULT_LAYOUT, 1100);
  expect(fitted.chaptersCollapsed).toBe(false);
  expect(fitted.reviewCollapsed).toBe(false);
  expect(fitted.chaptersWidth).toBeGreaterThanOrEqual(240);
  expect(fitted.reviewWidth).toBeGreaterThanOrEqual(240);
  expect(fitted.chaptersWidth + fitted.reviewWidth + 12).toBe(620);
});

test('collapses review before chapters as the window narrows', () => {
  expect(fitLayout(DEFAULT_LAYOUT, 900)).toMatchObject({
    chaptersCollapsed: false,
    reviewCollapsed: true,
    chaptersWidth: 315,
  });
});

test('collapses both sidebars when even chapters minimum does not fit', () => {
  expect(fitLayout(DEFAULT_LAYOUT, 700)).toMatchObject({
    chaptersCollapsed: true,
    reviewCollapsed: true,
  });
});

test('does not mutate preferred values while clamping effective widths', () => {
  const preferred = { chaptersWidth: 550, reviewWidth: 500 };
  const copy = { ...preferred };
  fitLayout(preferred, 1100);
  expect(preferred).toEqual(copy);
});
