import { parseDocument, isMap, isScalar } from 'yaml';
import { parser } from '@lezer/markdown';

export type Frontmatter = {
  yaml: string;
  end: number;
  byteEnd: number;
  derivedEnd: number;
  eol: string;
  error: string | null;
  title: string | null;
};
function parse(yaml: string): { error: string | null; title: string | null } {
  const doc = parseDocument(yaml, {
    schema: 'core',
    customTags: [],
    prettyErrors: false,
    uniqueKeys: true,
  });
  const issue = doc.errors[0] ?? doc.warnings[0];
  if (issue) return { error: `YAML: ${issue.message}`, title: null };
  if (doc.contents !== null && !isMap(doc.contents))
    return { error: 'YAML: ожидается набор ключей и значений', title: null };
  const title = isMap(doc.contents) ? doc.contents.get('title', true) : null;
  const value: unknown = isScalar(title) ? title.value : null;
  return {
    error: null,
    title:
      typeof value === 'string' && value.trim()
        ? value.trim().replace(/\s+/g, ' ')
        : null,
  };
}
/** Keep raw UTF-16, UTF-8 and normalized editor boundaries distinct. Never strip the document. */
export function frontmatter(source: string): Frontmatter | null {
  const start = /^(?:\uFEFF)?---[ \t]*(\r\n|\n|\r)/.exec(source);
  if (!start) return null;
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/gm;
  close.lastIndex = start[0].length;
  const match = close.exec(source);
  const end = match ? match.index + match[0].length : source.length;
  const yaml = source.slice(start[0].length, match?.index ?? end);
  const parsed = parse(yaml);
  return {
    yaml,
    end,
    byteEnd: new TextEncoder().encode(source.slice(0, end)).length,
    derivedEnd: source.slice(0, end).replace(/^\uFEFF/, '').replace(/\r\n?|\n/g, '\n').length,
    eol: start[1]!,
    ...parsed,
    error: match ? parsed.error : 'YAML: нет закрывающей строки ---',
  };
}
export function metadataReplacement(source: string, yaml: string): string {
  const fm = frontmatter(source);
  const normalized = yaml.replace(/\r\n?/g, '\n');
  const parsed = parse(normalized);
  if (parsed.error) throw new Error(parsed.error);
  // A delimiter inside editable YAML would escape into the manuscript.
  if (/^(?:---|\.\.\.)[ \t]*$/m.test(normalized))
    throw new Error('YAML: разделители --- не нужны в поле метаданных');
  const eol = fm?.eol ?? (source.includes('\r\n') ? '\r\n' : '\n');
  return (
    (source.startsWith('\uFEFF') ? '\uFEFF' : '') +
    '---' +
    eol +
    normalized.replace(/\n/g, eol) +
    (normalized.endsWith('\n') || !normalized ? '' : eol) +
    '---' +
    eol
  );
}
export function resolveTitle(
  source: string,
  manifest: string,
  filename: string,
): string {
  const fm = frontmatter(source);
  if (fm?.title) return fm.title;
  const body = source.slice(fm?.end ?? 0);
  let heading = '';
  parser.parse(body).iterate({
    enter(node) {
      if (node.name === 'ATXHeading1' || node.name === 'SetextHeading1') {
        if (!heading) {
          const underline = node.name === 'SetextHeading1' ? node.node.getChild('HeaderMark') : null;
          heading = body
            .slice(node.from, underline?.from ?? node.to)
            .replace(/^#[ \t]+/, '')
            .replace(/[ \t]+#+[ \t]*$/, '')
            .trim();
        }
        return false;
      }
    },
  });
  return (
    heading ||
    manifest.trim() ||
    filename.split(/[\\/]/).pop()!.replace(/\.md$/i, '')
  );
}
