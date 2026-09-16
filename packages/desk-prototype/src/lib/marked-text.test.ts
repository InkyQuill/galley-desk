import { describe, expect, it } from 'vitest';
import { markText } from './marked-text';
import type { RecordMarker } from '../data/fixtures';

const edit: RecordMarker = { id: 'e1', kind: 'edit', from: 6, to: 11, before: 'b', after: 'world' };

describe('markText', () => {
  it('returns the whole text as one plain segment when there are no records', () => {
    expect(markText('hello world', [])).toEqual([{ text: 'hello world', record: null }]);
  });

  it('splits a single marker in the middle into plain/marked/plain', () => {
    expect(markText('hello world', [edit])).toEqual([
      { text: 'hello ', record: null },
      { text: 'world', record: edit },
    ]);
  });

  it('marks a segment that starts at position 0', () => {
    const start: RecordMarker = { id: 'e2', kind: 'edit', from: 0, to: 5, before: 'x', after: 'hello' };
    expect(markText('hello world', [start])).toEqual([
      { text: 'hello', record: start },
      { text: ' world', record: null },
    ]);
  });

  it('sorts unsorted input records by position', () => {
    const second: RecordMarker = { id: 'e3', kind: 'edit', from: 6, to: 11, before: 'x', after: 'world' };
    const first: RecordMarker = { id: 'e4', kind: 'edit', from: 0, to: 5, before: 'y', after: 'hello' };
    expect(markText('hello world', [second, first])).toEqual([
      { text: 'hello', record: first },
      { text: ' ', record: null },
      { text: 'world', record: second },
    ]);
  });

  it('clamps a marker range that extends past the end of the text', () => {
    const overrun: RecordMarker = { id: 'e5', kind: 'edit', from: 6, to: 999, before: 'x', after: 'world' };
    expect(markText('hello world', [overrun])).toEqual([
      { text: 'hello ', record: null },
      { text: 'world', record: overrun },
    ]);
  });

  it('skips a zero-length marker range', () => {
    const empty: RecordMarker = { id: 'e6', kind: 'edit', from: 5, to: 5, before: '', after: '' };
    expect(markText('hello world', [empty])).toEqual([{ text: 'hello world', record: null }]);
  });
});
