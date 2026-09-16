import { afterEach, expect, test } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
  rename,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeReview } from '@galley-desk/pocket-format';
import { openBook, readPair, manageBook, discoverChapters } from './book';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture(version = 1) {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-management-'));
  dirs.push(root);
  await writeFile(path.join(root, 'a.md'), '# Alpha\n');
  const book = await openBook(root);
  const raw = JSON.parse(
    await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
  );
  raw.schema_version = version;
  raw.ignored_files = ['ignored.md'];
  if (version === 2) {
    delete raw.chapters[0].title;
    raw.custom = { keep: true };
    raw.chapters[0].custom = 'keep';
  }
  await writeFile(path.join(root, '.pocket-editor.json'), JSON.stringify(raw));
  return { root, book: await openBook(root), raw };
}
test.each([1, 2])(
  'management preserves v%s wire/order/identity/ignored fields and discovers explicitly',
  async (version) => {
    const { root, book, raw } = await fixture(version);
    await writeFile(path.join(root, 'extra.md'), '# Extra\n');
    await writeFile(path.join(root, 'ignored.md'), 'ignored');
    await symlink(path.join(root, 'a.md'), path.join(root, 'escape.md'));
    expect((await discoverChapters(book)).map((x) => x.path)).toEqual([
      'extra.md',
    ]);
    await manageBook(book, { type: 'rename', title: 'Renamed' });
    await manageBook(book, { type: 'create', path: 'new.md', title: 'New' });
    await manageBook(book, { type: 'add', paths: ['extra.md'] });
    const saved = JSON.parse(
      await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
    );
    expect(saved.schema_version).toBe(version);
    expect(saved.title).toBe('Renamed');
    expect(saved.chapters[0]).toEqual(raw.chapters[0]);
    expect(saved.ignored_files).toEqual(['ignored.md']);
    expect(saved.custom).toEqual(raw.custom);
    expect(saved.chapters.map((x: { path: string }) => x.path)).toEqual([
      'a.md',
      'new.md',
      'extra.md',
    ]);
    expect(await readFile(path.join(root, 'new.md'), 'utf8')).toBe('# New\n');
  },
);
test('remove and re-add reuse validated legacy review identity and bytes across reopen', async () => {
  const { root, book } = await fixture();
  const chapter = book.manifest.chapters[0]!;
  const review = encodeReview({
    schema_version: 1,
    chapter_id: chapter.id,
    source_path: 'a.md',
    chapter_note: 'keep note',
    edits: [],
    signals: [],
  });
  await writeFile(path.join(root, 'a.md.review.json'), review);
  await manageBook(book, { type: 'remove', chapterId: chapter.id });
  const reopened = await openBook(root);
  await manageBook(reopened, { type: 'add', paths: ['a.md'] });
  expect(reopened.manifest.chapters[0]!.id).toBe(chapter.id);
  expect((await readPair(await openBook(root), chapter.id)).pair.review).toBe(
    review,
  );
});
test('unsafe, ignored, duplicate and ambiguous additions do not mutate manifest', async () => {
  const { root, book } = await fixture();
  const before = await readFile(path.join(root, '.pocket-editor.json'), 'utf8');
  for (const name of ['../outside.md', 'a.md', 'ignored.md'])
    await expect(
      manageBook(book, { type: 'add', paths: [name] }),
    ).rejects.toThrow();
  await symlink(path.join(root, 'a.md'), path.join(root, 'escape.md'));
  await expect(
    manageBook(book, { type: 'add', paths: ['escape.md'] }),
  ).rejects.toThrow();
  await writeFile(path.join(root, 'extra.md'), 'Extra');
  const review = encodeReview({
    schema_version: 1,
    chapter_id: book.manifest.chapters[0]!.id,
    source_path: 'extra.md',
    chapter_note: '',
    edits: [],
    signals: [],
  });
  await writeFile(path.join(root, 'extra.review.json'), review);
  await expect(
    manageBook(book, { type: 'add', paths: ['extra.md'] }),
  ).rejects.toThrow();
  await writeFile(path.join(root, 'extra.md.review.json'), review);
  await expect(
    manageBook(book, { type: 'add', paths: ['extra.md'] }),
  ).rejects.toThrow();
  expect(await readFile(path.join(root, '.pocket-editor.json'), 'utf8')).toBe(
    before,
  );
});
test('external manifest conflict and existing creation target leave files intact', async () => {
  const { root, book } = await fixture();
  await expect(
    manageBook(book, { type: 'create', path: 'a.md', title: 'Overwrite' }),
  ).rejects.toThrow();
  const external = JSON.stringify({ ...book.manifest, title: 'External' });
  await writeFile(path.join(root, '.pocket-editor.json'), external);
  await expect(
    manageBook(book, { type: 'create', path: 'new.md', title: 'New' }),
  ).rejects.toThrow(/manifest/i);
  expect(await readFile(path.join(root, '.pocket-editor.json'), 'utf8')).toBe(
    external,
  );
  await expect(readFile(path.join(root, 'new.md'))).rejects.toThrow();
});
test('trash failure retains spine with explicit moved/remain information; missing removal works', async () => {
  const { root, book } = await fixture();
  const chapter = book.manifest.chapters[0]!;
  await writeFile(
    path.join(root, 'a.review.json'),
    encodeReview({
      schema_version: 1,
      chapter_id: chapter.id,
      source_path: 'a.md',
      chapter_note: '',
      edits: [],
      signals: [],
    }),
  );
  const calls: string[] = [];
  await expect(
    manageBook(
      book,
      { type: 'trash', chapterId: chapter.id },
      async (target) => {
        calls.push(target);
        if (calls.length === 2) throw Error('trash unavailable');
        await rename(target, `${target}.trashed`);
      },
    ),
  ).rejects.toThrow(/a.md.*a.review.json/);
  expect(book.manifest.chapters).toHaveLength(1);
  expect(calls).toHaveLength(2);
  await manageBook(book, { type: 'remove', chapterId: chapter.id });
  expect(book.manifest.chapters).toHaveLength(0);
});

test('trash moves both validated files before removing spine; rejects sidecar symlink and identity mismatch', async () => {
  const { root, book } = await fixture();
  const chapter = book.manifest.chapters[0]!;
  const reviewPath = path.join(root, 'a.review.json');
  await symlink(path.join(root, 'a.md'), reviewPath);
  const moved: string[] = [];
  const trash = async (target: string) => {
    moved.push(target);
    await rename(target, `${target}.trashed`);
  };
  await expect(
    manageBook(book, { type: 'trash', chapterId: chapter.id }, trash),
  ).rejects.toThrow();
  expect(moved).toEqual([]);
  await rm(reviewPath);
  await writeFile(
    reviewPath,
    encodeReview({
      schema_version: 1,
      chapter_id: '22222222-2222-4222-8222-222222222222',
      source_path: 'a.md',
      chapter_note: '',
      edits: [],
      signals: [],
    }),
  );
  await expect(
    manageBook(book, { type: 'trash', chapterId: chapter.id }, trash),
  ).rejects.toThrow();
  expect(moved).toEqual([]);
  await writeFile(
    reviewPath,
    encodeReview({
      schema_version: 1,
      chapter_id: chapter.id,
      source_path: 'a.md',
      chapter_note: '',
      edits: [],
      signals: [],
    }),
  );
  await manageBook(book, { type: 'trash', chapterId: chapter.id }, trash);
  expect(moved).toEqual([path.join(root, 'a.md'), reviewPath]);
  expect((await openBook(root)).manifest.chapters).toEqual([]);
});
