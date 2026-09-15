import { expect, test } from 'vitest';
import { makeAnchor, sha256 } from './anchors';
import { decodeManifest, decodeReview, encodeManifest, encodeReview } from './documents';
import type { Anchor, Edit, Manifest, Review, Signal } from './documents';

const CHAPTER_ID = '11111111-1111-4111-8111-111111111111';

function anchorOn(source: string, from: number, to: number): Anchor {
  return makeAnchor(new TextEncoder().encode(source), { from, to });
}

function edit(id: string, overrides: Partial<Edit> = {}): Edit {
  return {
    id,
    before: 'кот',
    after: 'кит',
    anchor: anchorOn('кот спит', 0, 6),
    ...overrides,
  };
}

function signal(id: string, overrides: Partial<Signal> = {}): Signal {
  return {
    id,
    type: 'note',
    selected_text: 'кот',
    anchor: anchorOn('кот спит', 0, 6),
    comment: '',
    ...overrides,
  };
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    schema_version: 1,
    chapter_id: CHAPTER_ID,
    source_path: '01.md',
    chapter_note: '',
    edits: [],
    signals: [],
    ...overrides,
  };
}

test('encodes the canonical Kotlin layout with a trailing LF', () => {
  const text = encodeReview(review());
  expect(text).toBe(`{
  "schema_version": 1,
  "chapter_id": "${CHAPTER_ID}",
  "source_path": "01.md",
  "chapter_note": "",
  "signals": [],
  "edits": []
}
`);
});

test('encodes records sorted by id with fixed field order', () => {
  const text = encodeReview(review({
    edits: [
      edit('44444444-4444-4444-8444-444444444444'),
      edit('22222222-2222-4222-8222-222222222222'),
    ],
    signals: [signal('33333333-3333-4333-8333-333333333333', { comment: 'проверить' })],
  }));
  expect(text).toBe(`{
  "schema_version": 1,
  "chapter_id": "${CHAPTER_ID}",
  "source_path": "01.md",
  "chapter_note": "",
  "signals": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "type": "note",
      "selected_text": "кот",
      "anchor": {
        "source_sha256": "${anchorOn('кот спит', 0, 6).source_sha256}",
        "selection_sha256": "${anchorOn('кот спит', 0, 6).selection_sha256}",
        "start_byte": 0,
        "end_byte": 6,
        "start_line": 1,
        "end_line": 1,
        "prefix": "",
        "suffix": " спит"
      },
      "comment": "проверить"
    }
  ],
  "edits": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "before": "кот",
      "after": "кит",
      "anchor": {
        "source_sha256": "${anchorOn('кот спит', 0, 6).source_sha256}",
        "selection_sha256": "${anchorOn('кот спит', 0, 6).selection_sha256}",
        "start_byte": 0,
        "end_byte": 6,
        "start_line": 1,
        "end_line": 1,
        "prefix": "",
        "suffix": " спит"
      }
    },
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "before": "кот",
      "after": "кит",
      "anchor": {
        "source_sha256": "${anchorOn('кот спит', 0, 6).source_sha256}",
        "selection_sha256": "${anchorOn('кот спит', 0, 6).selection_sha256}",
        "start_byte": 0,
        "end_byte": 6,
        "start_line": 1,
        "end_line": 1,
        "prefix": "",
        "suffix": " спит"
      }
    }
  ]
}
`);
});

test('encoding is idempotent', () => {
  const first = encodeReview(review({ edits: [edit('22222222-2222-4222-8222-222222222222')] }));
  const second = encodeReview(decodeReview(first, CHAPTER_ID, '01.md'));
  expect(second).toBe(first);
});

test('decoding fills absent defaults exactly like Kotlin', () => {
  const json = `{"chapter_id":"${CHAPTER_ID}","source_path":"01.md"}`;
  expect(decodeReview(json, CHAPTER_ID, '01.md')).toEqual(review());
});

test('round trips signals and edits', () => {
  const value = review({
    chapter_note: 'проверить после правок',
    edits: [edit('22222222-2222-4222-8222-222222222222', { after: 'кот (спит)' })],
    signals: [signal('33333333-3333-4333-8333-333333333333', { type: 'change_required' })],
  });
  expect(decodeReview(encodeReview(value), CHAPTER_ID, '01.md')).toEqual(value);
});

test('rejects a sidecar whose chapter_id does not match the manifest', () => {
  const json = encodeReview(review({ chapter_id: '99999999-9999-4999-8999-999999999999' }));
  expect(() => decodeReview(json, CHAPTER_ID, '01.md')).toThrow(
    'Review chapter_id does not match its manifest entry',
  );
});

test('rejects a sidecar whose source_path does not match the chapter', () => {
  const json = encodeReview(review({ source_path: '02.md' }));
  expect(() => decodeReview(json, CHAPTER_ID, '01.md')).toThrow(
    'Review source_path does not match its source chapter',
  );
});

test('rejects an unsupported review schema version', () => {
  const json = '{"schema_version":2,"chapter_id":' +
    `"${CHAPTER_ID}","source_path":"01.md"}`;
  expect(() => decodeReview(json, CHAPTER_ID, '01.md')).toThrow();
});

test('rejects duplicate record ids across signals and edits', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const json = JSON.stringify({
    chapter_id: CHAPTER_ID,
    source_path: '01.md',
    edits: [edit(id)],
    signals: [signal(id, { anchor: anchorOn('кот спит', 7, 11) })],
  });
  expect(() => decodeReview(json, CHAPTER_ID, '01.md')).toThrow('Record IDs must be unique');
  expect(() => encodeReview(review({ edits: [edit(id), edit(id)] }))).toThrow(
    'Record IDs must be unique',
  );
});

test('rejects empty before and identical before/after', () => {
  expect(() => encodeReview(review({ edits: [edit('22222222-2222-4222-8222-222222222222', { before: '' })] })))
    .toThrow('Edit before text must not be empty');
  expect(() => encodeReview(review({ edits: [edit('22222222-2222-4222-8222-222222222222', { after: 'кот' })] })))
    .toThrow('Edit after text must differ from before text');
});

test('rejects malformed hashes', () => {
  const upper = anchorOn('кот спит', 0, 6);
  expect(() => encodeReview(review({
    edits: [edit('22222222-2222-4222-8222-222222222222', {
      anchor: { ...upper, source_sha256: upper.source_sha256.toUpperCase() },
    })],
  }))).toThrow('source_sha256 must be lowercase SHA-256 hex');
  expect(() => encodeReview(review({
    edits: [edit('22222222-2222-4222-8222-222222222222', {
      anchor: { ...upper, selection_sha256: 'deadbeef' },
    })],
  }))).toThrow('selection_sha256 must be lowercase SHA-256 hex');
});

test('rejects empty, reversed or misaligned byte ranges and line hints', () => {
  const anchor = anchorOn('кот спит', 7, 11);
  expect(() => encodeReview(review({
    edits: [edit('22222222-2222-4222-8222-222222222222', { anchor: { ...anchor, end_byte: 7 } })],
  }))).toThrow('Anchor byte range must be non-empty, non-negative, and half-open');
  expect(() => encodeReview(review({
    edits: [edit('22222222-2222-4222-8222-222222222222', { anchor: { ...anchor, start_line: 2, end_line: 1 } })],
  }))).toThrow('Anchor line hints must be one-based and ordered');
});

test('rejects unknown fields instead of dropping them', () => {
  const json = `{"chapter_id":"${CHAPTER_ID}","source_path":"01.md","unexpected":true}`;
  expect(() => decodeReview(json, CHAPTER_ID, '01.md')).toThrow(/schema/);
});

test('accepts a context of 128 astral code points and round trips it', () => {
  const prefix = '🙂'.repeat(128);
  const source = `${prefix}кот хвост`;
  const anchor = makeAnchor(new TextEncoder().encode(source), { from: 512, to: 518 });
  const json = encodeReview(review({
    signals: [signal('33333333-3333-4333-8333-333333333333', { anchor })],
  }));
  expect(json).toContain('"prefix"');
  expect(decodeReview(json, CHAPTER_ID, '01.md').signals[0]!.anchor.prefix).toBe(anchor.prefix);
});

test('rejects a context longer than 128 code points', () => {
  const anchor = { ...anchorOn('кот спит', 0, 6), prefix: 'a'.repeat(129) };
  expect(() => encodeReview(review({
    signals: [signal('33333333-3333-4333-8333-333333333333', { anchor })],
  }))).toThrow('Anchor prefix must not exceed 128 Unicode code points');
});

test('keeps intersecting edits readable and writable', () => {
  const source = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';
  const first = edit('22222222-2222-4222-8222-222222222222', {
    anchor: anchorOn(source, 0, 15),
    before: source.slice(0, 15),
  });
  const second = edit('33333333-3333-4333-8333-333333333333', {
    anchor: anchorOn(source, 10, 25),
    before: source.slice(10, 25),
  });
  const third = edit('44444444-4444-4444-8444-444444444444', {
    anchor: anchorOn(source, 20, 35),
    before: source.slice(20, 35),
  });
  const value = review({ edits: [first, second, third] });
  const json = encodeReview(value);
  expect(decodeReview(json, CHAPTER_ID, '01.md')).toEqual(value);
});

test('a sidecar with offsets beyond the safe integer range opens without rewriting', () => {
  const anchor = anchorOn('кот спит', 0, 6);
  const json = `{
    "chapter_id": "${CHAPTER_ID}",
    "source_path": "01.md",
    "edits": [
      {
        "id": "22222222-2222-4222-8222-222222222222",
        "before": "кот",
        "after": "кит",
        "anchor": {
          "source_sha256": "${anchor.source_sha256}",
          "selection_sha256": "${anchor.selection_sha256}",
          "start_byte": 9007199254740993,
          "end_byte": 9007199254740996,
          "start_line": 1,
          "end_line": 1,
          "prefix": "",
          "suffix": " спит"
        }
      }
    ]
  }`;
  const decoded = decodeReview(json, CHAPTER_ID, '01.md');
  expect(Number.isSafeInteger(decoded.edits[0]!.anchor.start_byte)).toBe(false);
  expect(() => encodeReview(decoded)).toThrow('safe integers');
});

test('escapes control characters, quotes and emoji byte-exactly', () => {
  const comment = 'line1\nline2\ttab "quoted" back\\slash 🙂\u0001\u000b';
  const value = review({
    signals: [signal('33333333-3333-4333-8333-333333333333', { comment })],
  });
  const json = encodeReview(value);
  expect(json).toContain('"comment": "line1\\nline2\\ttab \\"quoted\\" back\\\\slash 🙂\\u0001\\u000b"');
  expect(decodeReview(json, CHAPTER_ID, '01.md').signals[0]!.comment).toBe(comment);
});

const MANIFEST: Manifest = {
  schema_version: 1,
  book_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Книга',
  chapters: [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', path: '01.md', title: 'Глава 1' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', path: '02.md', title: 'Глава 2' },
  ],
  ignored_files: ['черновик.md'],
};

test('encodes the canonical manifest with sorted ignored files', () => {
  const text = encodeManifest({ ...MANIFEST, ignored_files: ['z.md', 'a.md'] });
  expect(text).toBe(`{
  "schema_version": 1,
  "book_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "title": "Книга",
  "chapters": [
    {
      "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "path": "01.md",
      "title": "Глава 1"
    },
    {
      "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "path": "02.md",
      "title": "Глава 2"
    }
  ],
  "ignored_files": [
    "a.md",
    "z.md"
  ]
}
`);
});

test('round trips a manifest without reordering chapters', () => {
  const json = encodeManifest(MANIFEST);
  expect(decodeManifest(json)).toEqual(MANIFEST);
});

test('rejects unsupported or missing manifest schema versions', () => {
  const v2 = JSON.stringify({ ...MANIFEST, schema_version: 2 });
  expect(() => decodeManifest(v2)).toThrow();
  const absent = JSON.stringify({
    book_id: MANIFEST.book_id,
    title: MANIFEST.title,
    chapters: MANIFEST.chapters,
    ignored_files: MANIFEST.ignored_files,
  });
  expect(() => decodeManifest(absent)).toThrow('Unsupported manifest schema version');
});

test('rejects duplicate chapter ids and paths', () => {
  const first = MANIFEST.chapters[0]!;
  const second = MANIFEST.chapters[1]!;
  const sameId: Manifest = {
    ...MANIFEST,
    chapters: [
      first,
      { ...second, id: first.id },
    ],
  };
  expect(() => encodeManifest(sameId)).toThrow('Chapter IDs must be unique');
  const samePath: Manifest = {
    ...MANIFEST,
    chapters: [
      first,
      { ...second, path: first.path },
    ],
  };
  expect(() => encodeManifest(samePath)).toThrow('Chapter paths must be unique');
});

test('rejects a chapter path that is also ignored', () => {
  const json = JSON.stringify({ ...MANIFEST, ignored_files: ['01.md'] });
  expect(() => decodeManifest(json)).toThrow('A chapter path cannot also be ignored');
});

test('rejects nested chapter paths and unknown fields', () => {
  const nested = JSON.stringify({
    ...MANIFEST,
    chapters: [{ ...MANIFEST.chapters[0], path: 'chapters/01.md' }],
  });
  expect(() => decodeManifest(nested)).toThrow();
  const unknown = JSON.stringify({ ...MANIFEST, extra: 1 });
  expect(() => decodeManifest(unknown)).toThrow();
});

test('sha256 helper matches node expectations', () => {
  expect(sha256(new TextEncoder().encode('кот'))).toHaveLength(64);
});
