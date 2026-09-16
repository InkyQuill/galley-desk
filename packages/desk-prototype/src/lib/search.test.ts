import { describe, expect, it } from 'vitest';
import { findLiteral } from './search';

describe('findLiteral', () => {
  it('returns no ranges for an empty query', () => {
    expect(findLiteral('hello world', '')).toEqual([]);
  });

  it('returns no ranges when the query is absent', () => {
    expect(findLiteral('hello world', 'xyz')).toEqual([]);
  });

  it('finds a single match', () => {
    expect(findLiteral('hello world', 'world')).toEqual([{ from: 6, to: 11 }]);
  });

  it('finds multiple non-overlapping matches', () => {
    expect(findLiteral('a cat sat on a mat', 'at')).toEqual([
      { from: 3, to: 5 },
      { from: 7, to: 9 },
      { from: 16, to: 18 },
    ]);
  });

  it('advances past each match instead of scanning overlapping windows', () => {
    expect(findLiteral('aaaa', 'aa')).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });
});
