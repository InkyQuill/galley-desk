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
