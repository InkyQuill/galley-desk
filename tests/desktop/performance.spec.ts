// Производительность на синтетической книге: 100 глав, одна глава 1 MiB
// UTF-8, 500 записей рецензии в ней. Замеры на этом железе записываются в
// test-results/performance-results.json (для docs/verification.md):
// - открытие большой главы ≤ 2 с (клик → текст виден);
// - p95 «ввод → рендер» ≤ 50 мс (beforeinput → DOM-изменение, MutationObserver);
// - RSS main-процесса и heap рендерера — фиксируются (бюджета нет).
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { encodeReview, makeAnchor } from '@galley-desk/pocket-format';
import type { Review } from '@galley-desk/pocket-format';

const BIG_CHAPTER = 'Глава 050.md';
const BIG_CHAPTER_TITLE = 'Глава 050';
const ONE_MIB = 1024 * 1024;
const TOTAL_RECORDS = 500;
const TYPING_SAMPLES = 24;
const OPEN_BUDGET_MS = 2000;
const P95_BUDGET_MS = 50;

const tempDirs: string[] = [];

function paragraph(index: number): string {
  return `Абзац ${String(index).padStart(6, '0')}: рыба текста слово-${String(index).padStart(6, '0')} конец абзаца.\n\n`;
}

/** Позиция подстроки в байтах (Uint8Array.indexOf не ищет по массиву-игле). */
function byteIndexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return start;
  }
  return -1;
}

/** Синтетическая книга: 100 глав, большая глава ≥1 MiB, 500 записей sidecar. */
async function makeBook(): Promise<{ bookRoot: string; bigChapterBytes: number; paragraphCount: number }> {
  const bookRoot = await mkdtemp(path.join(tmpdir(), 'galley-perf-book-'));
  tempDirs.push(bookRoot);
  const chapters: Array<{ id: string; path: string; title: string }> = [];
  for (let index = 1; index <= 100; index++) {
    const title = `Глава ${String(index).padStart(3, '0')}`;
    const id = randomUUID();
    chapters.push({ id, path: `${title}.md`, title });
    if (index === 50) continue; // большая глава пишется отдельно
    await writeFile(path.join(bookRoot, `${title}.md`), `# ${title}\n\nОбычный абзац с текстом главы.\n`, 'utf8');
  }

  // Большая глава: абзацы, пока байт не станет ≥1 MiB.
  const paragraphs: string[] = [];
  let bytes = 0;
  let index = 0;
  while (bytes < ONE_MIB) {
    const chunk = paragraph(index);
    bytes += Buffer.byteLength(chunk, 'utf8');
    paragraphs.push(chunk);
    index++;
  }
  const bigText = paragraphs.join('');
  await writeFile(path.join(bookRoot, BIG_CHAPTER), bigText, 'utf8');
  expect(bytes).toBeGreaterThanOrEqual(ONE_MIB);

  const bigChapter = chapters[49]!;
  const source = new TextEncoder().encode(bigText);

  // 500 записей: правки по уникальным токенам + сигналы рядом.
  const edits: Review['edits'] = [];
  const signals: Review['signals'] = [];
  const step = Math.max(1, Math.floor(paragraphs.length / TOTAL_RECORDS) - 1);
  let cursor = 5;
  const tokenOf = (n: number): string => `слово-${String(n).padStart(6, '0')}`;
  while (edits.length < 250) {
    const token = tokenOf(cursor);
    const from = byteIndexOf(source, new TextEncoder().encode(token));
    if (from >= 0) {
      const to = from + new TextEncoder().encode(token).length; // байты, не UTF-16 длина
      edits.push({
        id: randomUUID(),
        before: token,
        after: `${token}-прав`,
        anchor: makeAnchor(source, { from, to }),
      });
    }
    cursor += step;
  }
  while (signals.length < TOTAL_RECORDS - 250) {
    const token = tokenOf(cursor);
    const from = byteIndexOf(source, new TextEncoder().encode(token));
    if (from >= 0) {
      const to = from + new TextEncoder().encode(token).length;
      signals.push({
        id: randomUUID(),
        type: (['note', 'change_required', 'warning', 'review'] as const)[signals.length % 4],
        selected_text: token,
        anchor: makeAnchor(source, { from, to }),
        comment: `сигнал ${signals.length + 1}`,
      });
    }
    cursor += step;
  }
  const review: Review = {
    schema_version: 1,
    chapter_id: bigChapter.id,
    source_path: BIG_CHAPTER,
    chapter_note: 'Заметка большой главы',
    edits,
    signals,
  };
  await writeFile(
    path.join(bookRoot, BIG_CHAPTER.replace(/\.md$/, '.review.json')),
    encodeReview(review),
    'utf8',
  );

  const manifest = {
    schema_version: 1 as const,
    book_id: randomUUID(),
    title: 'Перф-книга',
    chapters,
  };
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest), 'utf8');
  return { bookRoot, bigChapterBytes: bytes, paragraphCount: paragraphs.length };
}

test('синтетическая книга: открытие главы, p95 ввода и RSS в бюджете', async () => {
  test.slow();
  const { bookRoot, bigChapterBytes } = await makeBook();
  const userData = await mkdtemp(path.join(tmpdir(), 'galley-perf-user-'));
  tempDirs.push(userData);

  const startedAt = Date.now();
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  try {
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.getByRole('button', { name: BIG_CHAPTER_TITLE })).toBeVisible({ timeout: 30_000 });
    const openBookMs = Date.now() - startedAt;

    // Открытие большой главы (1 MiB, 500 записей): клик → текст в редакторе.
    const openStartedAt = Date.now();
    await page.getByRole('button', { name: BIG_CHAPTER_TITLE }).click();
    await expect(page.locator('.book__text .cm-content')).toContainText('Абзац 000000', { timeout: 30_000 });
    const openChapterMs = Date.now() - openStartedAt;
    expect(openChapterMs).toBeLessThanOrEqual(OPEN_BUDGET_MS);

    // 500 записей в панели и счётчик списка — фиксируем, что стресс реально создан.
    const recordCount = await page.locator('.book__records .book__record').count();
    expect(recordCount).toBe(TOTAL_RECORDS);

    // Инструментация «ввод → рендер»: beforeinput → первое DOM-изменение
    // (MutationObserver в микрозадаче после мутации; без ожидания кадра).
    await page.locator('.book__text .cm-content').click();
    await page.evaluate(() => {
      const content = document.querySelector('.book__text .cm-content')!;
      const withMarks = window as unknown as { __lat: number | null; __t0: number };
      withMarks.__lat = null;
      withMarks.__t0 = 0;
      content.addEventListener('beforeinput', () => {
        withMarks.__t0 = performance.now();
      });
      new MutationObserver(() => {
        if (withMarks.__t0 > 0) {
          withMarks.__lat = performance.now() - withMarks.__t0;
          withMarks.__t0 = 0;
        }
      }).observe(content, { characterData: true, childList: true, subtree: true });
    });

    const latencies: number[] = [];
    for (let sample = 0; sample < TYPING_SAMPLES; sample++) {
      await page.keyboard.type('x');
      await page.waitForFunction(() => (window as unknown as { __lat: number | null }).__lat !== null, undefined, {
        timeout: 15_000,
      });
      latencies.push(
        await page.evaluate(() => {
          const withMarks = window as unknown as { __lat: number | null };
          const value = withMarks.__lat ?? 0;
          withMarks.__lat = null;
          return value;
        }),
      );
    }
    const sorted = [...latencies].sort((left, right) => left - right);
    const p95 = percentile(sorted, 0.95);
    const median = percentile(sorted, 0.5);
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);

    // RSS main-процесса и heap рендерера — фиксация факта (бюджета нет).
    const rssMainBytes = await app.evaluate(() => process.memoryUsage().rss);
    const rendererHeapBytes = await page.evaluate(
      () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    );

    const result = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      fixture: {
        chapters: 100,
        bigChapterBytes,
        records: TOTAL_RECORDS,
        typingSamples: TYPING_SAMPLES,
      },
      openBookMs,
      openChapterMs,
      openBudgetMs: OPEN_BUDGET_MS,
      inputToRenderMs: { median, p95, max: sorted[sorted.length - 1]!, samples: latencies },
      p95BudgetMs: P95_BUDGET_MS,
      rssMainBytes,
      rendererHeapBytes,
    };
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/performance-results.json', JSON.stringify(result, null, 2), 'utf8');
  } finally {
    await app.close().catch(() => undefined);
  }
});

function percentile(sorted: number[], fraction: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index]!;
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
