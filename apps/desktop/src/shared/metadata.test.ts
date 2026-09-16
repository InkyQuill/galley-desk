import { expect, test } from 'vitest';
import { frontmatter, metadataReplacement, resolveTitle } from './metadata';

test('only document-start delimiters count; byte and CM boundaries preserve Unicode CRLF', () => {
  const source = '---\r\ntitle: 🐈\r\n---\r\n# Body\r\n';
  const fm = frontmatter(source)!;
  expect(fm.end).toBe(source.indexOf('#'));
  expect(fm.byteEnd).toBe(
    new TextEncoder().encode(source.slice(0, fm.end)).length,
  );
  expect(fm.derivedEnd).toBe(
    source.slice(0, fm.end).replace(/\r\n/g, '\n').length,
  );
  expect(frontmatter('\n' + source)).toBeNull();
  expect(frontmatter('# body\n---\nx: 1\n---')).toBeNull();
  expect(
    metadataReplacement(source, 'title: Новое\nnested: {x: [1, 2]}\n# comment'),
  ).toBe('---\r\ntitle: Новое\r\nnested: {x: [1, 2]}\r\n# comment\r\n---\r\n');
});
test('invalid and unterminated YAML remain visible and repairable', () => {
  expect(frontmatter('---\ntitle: [\n---\nBody')?.error).toBeTruthy();
  expect(frontmatter('---\ntitle: x')?.error).toBeTruthy();
  expect(() => metadataReplacement('---\na: 1\n---\nbody', 'a: [')).toThrow();
});
test('title precedence ignores code-fenced H1 and preserves manifest fallback', () => {
  expect(
    resolveTitle('---\ntitle: Название\n---\n# H1', 'Manifest', '01.md'),
  ).toBe('Название');
  expect(resolveTitle('```\n# False\n```\n# Real', 'Manifest', '01.md')).toBe(
    'Real',
  );
  expect(resolveTitle('body', 'Manifest', '01.md')).toBe('Manifest');
  expect(resolveTitle('body', '', 'dir/01.md')).toBe('01');
});
test('unsafe YAML tags stay visible with an error and cannot be saved', () => {
  const yaml = 'run: !!js/function "function () { return 1 }"';
  expect(frontmatter('---\n' + yaml + '\n---\nBody')?.yaml).toContain(yaml);
  expect(frontmatter('---\n' + yaml + '\n---\nBody')?.error).toBeTruthy();
  expect(() => metadataReplacement('Body', yaml)).toThrow();
});

test('Setext titles exclude CRLF and indented underline parser markers', () => {
  expect(resolveTitle('Title\r\n=====\r\n', 'Manifest', '01.md')).toBe('Title');
  expect(resolveTitle('Title\n  =====\n', 'Manifest', '01.md')).toBe('Title');
  expect(resolveTitle('Title\r\n  =====\r\n', 'Manifest', '01.md')).toBe('Title');
});

test('BOM counts in source bytes but not in normalized editor metadata boundary', () => {
  const prefix = '\uFEFF---\r\ntitle: Old\r\n---\r\n';
  const fm = frontmatter(prefix+'Body')!;
  expect(fm.byteEnd).toBe(new TextEncoder().encode(prefix).length);
  expect(fm.end).toBe(prefix.length);
  expect(fm.derivedEnd).toBe(prefix.slice(1).replace(/\r\n/g,'\n').length);
  expect(metadataReplacement(prefix+'Body','title: New')).toBe(prefix.replace('Old','New'));
});

test('immutable source metadata cache reuses parsing but refreshes replaced source and manifest fallback', async () => {
  const { sourceMetadata } = await import('./metadata');
  const bytes = new TextEncoder().encode('\uFEFF---\r\ntitle: Old\r\n---\r\nBody');
  expect(sourceMetadata(bytes, 'Manifest', '01.md')).toEqual({ sourceText: '\uFEFF---\r\ntitle: Old\r\n---\r\nBody', title: 'Old' });
  expect(sourceMetadata(bytes, 'Changed manifest', '02.md').title).toBe('Old');
  const replacement = new TextEncoder().encode('---\ntitle: New\n---\nBody');
  expect(sourceMetadata(replacement, '', '01.md').title).toBe('New');
  expect(sourceMetadata(new TextEncoder().encode('# Applied heading'), '', '01.md').title).toBe('Applied heading');
  const body = new TextEncoder().encode('No heading');
  expect(sourceMetadata(body, 'First', '01.md').title).toBe('First');
  expect(sourceMetadata(body, 'Second', '01.md').title).toBe('Second');
  expect(sourceMetadata(body, '', '02.md').title).toBe('02');
});

test('repeated snapshots parse an unchanged source only once', async () => {
  const { vi } = await import('vitest');
  const { parser } = await import('@lezer/markdown');
  const { sourceMetadata } = await import('./metadata');
  const parse = vi.spyOn(parser, 'parse');
  try {
    const source = new TextEncoder().encode('# Cached heading\nbody');
    sourceMetadata(source, '', 'a.md');
    sourceMetadata(source, '', 'a.md');
    expect(parse).toHaveBeenCalledTimes(1);
    sourceMetadata(new TextEncoder().encode('# External heading'), '', 'a.md');
    expect(parse).toHaveBeenCalledTimes(2);
  } finally { parse.mockRestore(); }
});
