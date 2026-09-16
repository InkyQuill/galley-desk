# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: performance.spec.ts >> синтетическая книга: открытие главы, p95 ввода и RSS в бюджете
- Location: tests/desktop/performance.spec.ts:140:1

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 50
Received:    70.2000000178814
```

# Test source

```ts
  125 |     path.join(bookRoot, BIG_CHAPTER.replace(/\.md$/, '.review.json')),
  126 |     encodeReview(review),
  127 |     'utf8',
  128 |   );
  129 | 
  130 |   const manifest = {
  131 |     schema_version: 1 as const,
  132 |     book_id: randomUUID(),
  133 |     title: 'Перф-книга',
  134 |     chapters,
  135 |   };
  136 |   await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest), 'utf8');
  137 |   return { bookRoot, bigChapterBytes: bytes, paragraphCount: paragraphs.length };
  138 | }
  139 | 
  140 | test('синтетическая книга: открытие главы, p95 ввода и RSS в бюджете', async () => {
  141 |   test.slow();
  142 |   const { bookRoot, bigChapterBytes } = await makeBook();
  143 |   const userData = await mkdtemp(path.join(tmpdir(), 'galley-perf-user-'));
  144 |   tempDirs.push(userData);
  145 | 
  146 |   const startedAt = Date.now();
  147 |   const app = await electron.launch({
  148 |     args: ['apps/desktop'],
  149 |     env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  150 |   });
  151 |   const page = await app.firstWindow();
  152 |   await page.setViewportSize({ width: 1280, height: 900 });
  153 |   await app.evaluate(({ dialog }, root) => {
  154 |     dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  155 |   }, bookRoot);
  156 |   try {
  157 |     await page.getByRole('button', { name: 'Открыть папку…' }).click();
  158 |     await expect(page.getByRole('button', { name: BIG_CHAPTER_TITLE })).toBeVisible({ timeout: 30_000 });
  159 |     const openBookMs = Date.now() - startedAt;
  160 | 
  161 |     // Открытие большой главы (1 MiB, 500 записей): клик → текст в редакторе.
  162 |     const openStartedAt = Date.now();
  163 |     await page.getByRole('button', { name: BIG_CHAPTER_TITLE }).click();
  164 |     await expect(page.locator('.book__text .cm-content')).toContainText('Абзац 000000', { timeout: 30_000 });
  165 |     const openChapterMs = Date.now() - openStartedAt;
  166 |     expect(openChapterMs).toBeLessThanOrEqual(OPEN_BUDGET_MS);
  167 | 
  168 |     // 500 записей в панели и счётчик списка — фиксируем, что стресс реально создан.
  169 |     const recordCount = await page.locator('.book__records .book__record').count();
  170 |     expect(recordCount).toBe(TOTAL_RECORDS);
  171 | 
  172 |     // Инструментация «ввод → рендер»: beforeinput → первое DOM-изменение
  173 |     // (MutationObserver в микрозадаче после мутации; без ожидания кадра).
  174 |     await page.locator('.book__text .cm-content').click();
  175 |     await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  176 |     const source = await readFile(path.join(bookRoot, BIG_CHAPTER));
  177 |     const sidecarPath = path.join(bookRoot, BIG_CHAPTER.replace(/\.md$/, '.review.json'));
  178 |     const initialText = openChapter(source, JSON.parse(await readFile(sidecarPath, 'utf8'))).text;
  179 |     await page.evaluate(() => {
  180 |       const content = document.querySelector('.book__text .cm-content')!;
  181 |       const withMarks = window as unknown as { __lat: number | null; __t0: number };
  182 |       withMarks.__lat = null;
  183 |       withMarks.__t0 = 0;
  184 |       content.addEventListener('beforeinput', () => {
  185 |         withMarks.__t0 = performance.now();
  186 |       });
  187 |       new MutationObserver(() => {
  188 |         if (withMarks.__t0 > 0) {
  189 |           withMarks.__lat = performance.now() - withMarks.__t0;
  190 |           withMarks.__t0 = 0;
  191 |         }
  192 |       }).observe(content, { characterData: true, childList: true, subtree: true });
  193 |     });
  194 | 
  195 |     const latencies: number[] = [];
  196 |     const confirmedSaveLatencies: number[] = [];
  197 |     for (let sample = 0; sample < TYPING_SAMPLES; sample++) {
  198 |       const saveStartedAt = performance.now();
  199 |       await page.keyboard.type('x');
  200 |       await page.waitForFunction(() => (window as unknown as { __lat: number | null }).__lat !== null, undefined, {
  201 |         timeout: 15_000,
  202 |       });
  203 |       latencies.push(
  204 |         await page.evaluate(() => {
  205 |           const withMarks = window as unknown as { __lat: number | null };
  206 |           const value = withMarks.__lat ?? 0;
  207 |           withMarks.__lat = null;
  208 |           return value;
  209 |         }),
  210 |       );
  211 |       await expect.poll(async () => openChapter(source, JSON.parse(await readFile(sidecarPath, 'utf8'))).text, { timeout: 30_000 }).toBe('x'.repeat(sample + 1) + initialText);
  212 |       await expect(page.locator('.book__save-state')).toHaveText('Сохранено');
  213 |       confirmedSaveLatencies.push(performance.now() - saveStartedAt);
  214 |     }
  215 |     await page.getByRole('button', { name: 'Меню книги' }).click();
  216 |     await page.getByRole('button', { name: 'Закрыть книгу' }).click();
  217 |     await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  218 |     await page.getByRole('button', { name: BIG_CHAPTER_TITLE }).click();
  219 |     await expect(page.locator('.cm-content')).toContainText('x'.repeat(TYPING_SAMPLES) + 'Абзац 000000');
  220 |     expect(openChapter(await readFile(path.join(bookRoot, BIG_CHAPTER)), JSON.parse(await readFile(sidecarPath, 'utf8'))).text).toBe('x'.repeat(TYPING_SAMPLES) + initialText);
  221 |     expect(await readFile(path.join(bookRoot, BIG_CHAPTER))).toEqual(source);
  222 |     const sorted = [...latencies].sort((left, right) => left - right);
  223 |     const p95 = percentile(sorted, 0.95);
  224 |     const median = percentile(sorted, 0.5);
> 225 |     expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
      |                 ^ Error: expect(received).toBeLessThanOrEqual(expected)
  226 | 
  227 |     // RSS main-процесса и heap рендерера — фиксация факта (бюджета нет).
  228 |     const rssMainBytes = await app.evaluate(() => process.memoryUsage().rss);
  229 |     const rendererHeapBytes = await page.evaluate(
  230 |       () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  231 |     );
  232 | 
  233 |     const result = {
  234 |       timestamp: new Date().toISOString(),
  235 |       platform: process.platform,
  236 |       fixture: {
  237 |         chapters: 100,
  238 |         bigChapterBytes,
  239 |         records: TOTAL_RECORDS,
  240 |         typingSamples: TYPING_SAMPLES,
  241 |       },
  242 |       openBookMs,
  243 |       openChapterMs,
  244 |       openBudgetMs: OPEN_BUDGET_MS,
  245 |       inputToRenderMs: { median, p95, max: sorted[sorted.length - 1]!, samples: latencies },
  246 |       inputToConfirmedSaveMs: { samples: confirmedSaveLatencies, p95: percentile([...confirmedSaveLatencies].sort((a, b) => a - b), 0.95) },
  247 |       saveMeasurement: "host keyboard dispatch through matching sidecar read and saved UI acknowledgement; includes polling overhead, not physical media fsync timing",
  248 |       finalTextAfterReopen: "exact engine reconstruction and visible prefix verified",
  249 |       p95BudgetMs: P95_BUDGET_MS,
  250 |       rssMainBytes,
  251 |       rendererHeapBytes,
  252 |     };
  253 |     await mkdir('test-results', { recursive: true });
  254 |     await writeFile('test-results/performance-results.json', JSON.stringify(result, null, 2), 'utf8');
  255 |   } finally {
  256 |     await app.close().catch(() => undefined);
  257 |   }
  258 | });
  259 | 
  260 | function percentile(sorted: number[], fraction: number): number {
  261 |   const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  262 |   return sorted[index]!;
  263 | }
  264 | 
  265 | test.afterEach(async () => {
  266 |   await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  267 | });
  268 | 
```