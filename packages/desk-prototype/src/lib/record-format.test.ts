import { describe, expect, it } from 'vitest';
import { recordColor, recordDisplay, truncate } from './record-format';
import type { EditMarker, SignalMarker } from '../data/fixtures';

describe('truncate', () => {
  it('leaves short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with an ellipsis', () => {
    expect(truncate('a very long piece of text', 10)).toBe('a very lo…');
    expect(truncate('a very long piece of text', 10)).toHaveLength(10);
  });
});

describe('recordDisplay', () => {
  it('formats an edit as before → after with the accent color', () => {
    const edit: EditMarker = { id: 'e1', kind: 'edit', from: 0, to: 5, before: 'b', after: 'a' };
    expect(recordDisplay(edit)).toEqual({ icon: 'edit', colorKey: 'accent', label: 'b → a' });
  });

  it('formats a signal with a comment as the comment text', () => {
    const signal: SignalMarker = {
      id: 's1',
      kind: 'signal',
      from: 0,
      to: 5,
      signalType: 'warning',
      comment: 'Повтор слова.',
    };
    expect(recordDisplay(signal)).toEqual({ icon: 'signal', colorKey: 'warning', label: 'Повтор слова.' });
  });

  it('falls back to the Russian type label when a signal has no comment', () => {
    const signal: SignalMarker = { id: 's2', kind: 'signal', from: 0, to: 5, signalType: 'review', comment: '' };
    expect(recordDisplay(signal).label).toBe('На проверку');
  });
});

describe('recordColor', () => {
  it('resolves the accent color for edits', () => {
    expect(recordColor('accent')).toBe('var(--app-accent)');
  });

  it('resolves a fixed hex color for each signal type', () => {
    expect(recordColor('note')).toMatch(/^#[0-9a-f]{6}$/);
    expect(recordColor('change_required')).toMatch(/^#[0-9a-f]{6}$/);
    expect(recordColor('warning')).toMatch(/^#[0-9a-f]{6}$/);
    expect(recordColor('review')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
