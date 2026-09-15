import { expect, test } from 'vitest';
import { discover } from './discovery';
import type { Manifest } from './documents';

function file(path: string, text: string): { path: string; bytes: Uint8Array } {
  return { path, bytes: new TextEncoder().encode(text) };
}

const MANIFEST: Manifest = {
  schema_version: 1,
  book_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Книга',
  chapters: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', path: '01.md', title: 'Первая' }],
  ignored_files: ['черновик.md'],
};

test('orders chapters by front matter number, then unnumbered naturally', () => {
  const proposals = discover([
    file('b.md', '# Бэ'),
    file('a10.md', '---\nnumber: 10\n---\n# А-десять'),
    file('a2.md', '---\nnumber: 2\n---\n# А-два'),
    file('a1.md', '---\nnumber: 1\n---\n# А-один'),
  ]);
  expect(proposals.map((chapter) => chapter.path)).toEqual(['a1.md', 'a2.md', 'a10.md', 'b.md']);
});

test('compares unnumbered paths naturally, so 2 precedes 10', () => {
  const proposals = discover([
    file('Глава 10.md', '# Десять'),
    file('Глава 2.md', '# Два'),
  ]);
  expect(proposals.map((chapter) => chapter.path)).toEqual(['Глава 2.md', 'Глава 10.md']);
});

test('breaks natural ties case-insensitively and by full path last', () => {
  expect(discover([file('B.md', '# Бэ'), file('a.md', '# А')]).map((c) => c.path))
    .toEqual(['a.md', 'B.md']);
});

test('takes titles from the first level one heading', () => {
  const proposals = discover([file('01.md', 'вступление\n\n# Глава первая\n\nтекст\n\n## подраздел\n')]);
  expect(proposals).toEqual([{ path: '01.md', title: 'Глава первая' }]);
});

test('flattens inline formatting and code in headings', () => {
  const proposals = discover([file('01.md', '# **Жирный** и `код` и [ссылка](x.md)\n')]);
  expect(proposals[0]!.title).toBe('Жирный и код и ссылка');
});

test('ignores headings inside fenced code but reads setext and quotes', () => {
  const proposals = discover([
    file('a.md', '```\n# не заголовок\n```\n\nНастоящая\n=========\n'),
    file('b.md', '> # Цитата\n'),
  ]);
  expect(proposals.map((c) => c.title)).toEqual(['Настоящая', 'Цитата']);
});

test('prefers front matter title over the heading and falls back to the path', () => {
  const proposals = discover([
    file('first.md', '---\ntitle: "Из метаданных"\nnumber: 1\n---\n# Из текста\n'),
    file('без-заголовка.md', 'просто текст\n'),
  ]);
  expect(proposals.map((c) => c.title)).toEqual(['Из метаданных', 'без-заголовка']);
});

test('drops hidden files and nested paths', () => {
  const proposals = discover([
    file('.hidden.md', '# Скрытый'),
    file('.md', '# Пустое имя'),
    file('sub/nested.md', '# Вложенный'),
    file('data\\nested.md', '# Вложенный в Windows-пути'),
    file('обычный.md', '# Обычный'),
  ]);
  expect(proposals).toEqual([{ path: 'обычный.md', title: 'Обычный' }]);
});

test('excludes known chapter paths and ignored files from the manifest', () => {
  const proposals = discover([
    file('01.md', '# Первая'),
    file('черновик.md', '# Черновик'),
    file('02.md', '# Вторая'),
  ], MANIFEST);
  expect(proposals).toEqual([{ path: '02.md', title: 'Вторая' }]);
});

test('keeps the stable proposal order when a manifest exists', () => {
  const proposals = discover([
    file('03.md', '---\nnumber: 3\n---\n# Третья'),
    file('02.md', '---\nnumber: 2\n---\n# Вторая'),
    file('01.md', '# Первая'),
  ], MANIFEST);
  expect(proposals.map((c) => c.path)).toEqual(['02.md', '03.md']);
});

test('an ignored file does not shift the order of remaining proposals', () => {
  const withIgnored = discover([
    file('c.md', '# Це'),
    file('b.md', '# Бэ'),
    file('a.md', '# А'),
  ], { ...MANIFEST, ignored_files: ['b.md'] });
  expect(withIgnored.map((c) => c.path)).toEqual(['a.md', 'c.md']);
});

test('parses front matter numbers like Kotlin Int', () => {
  expect(discover([file('a.md', '---\nnumber: 007\n---\n')])[0]!.path).toBe('a.md');
  const overflow = discover([
    file('big.md', '---\nnumber: 99999999999\n---\n# Большой'),
    file('small.md', '---\nnumber: 2\n---\n# Малый'),
  ]);
  expect(overflow.map((c) => c.path)).toEqual(['small.md', 'big.md']);
});

test('rejects sources that are not valid UTF-8', () => {
  expect(() => discover([{ path: 'a.md', bytes: Uint8Array.of(0xff, 0xfe, 0x23, 0x20, 0x78) }])).toThrow();
});

test('an empty file list yields no proposals', () => {
  expect(discover([])).toEqual([]);
});
