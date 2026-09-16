# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: review-actions.spec.ts >> черновик заметки главы не переезжает в другую главу
- Location: tests/desktop/review-actions.spec.ts:294:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Вторая', exact: true })

```

# Test source

```ts
  212 |   const manifest = {
  213 |     schema_version: 1,
  214 |     book_id: randomUUID(),
  215 |     title: 'Тестовая книга',
  216 |     chapters: [
  217 |       { id: review.chapter_id, path: CHAPTER_PATH, title: 'Глава' },
  218 |       { id: CHAPTER2_ID, path: CHAPTER2_PATH, title: 'Вторая' },
  219 |     ],
  220 |     ignored_files: [],
  221 |   };
  222 |   await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest, null, 2));
  223 |   await writeFile(path.join(bookRoot, CHAPTER_PATH), SOURCE_TEXT, 'utf8');
  224 |   await writeFile(path.join(bookRoot, CHAPTER2_PATH), SOURCE_TEXT, 'utf8');
  225 |   await writeFile(path.join(bookRoot, SIDECAR_PATH), encodeReview({ ...review, chapter_note: noteA }), 'utf8');
  226 | }
  227 | 
  228 | /** Выделяет length символов с начала документа клавиатурой. */
  229 | async function selectFromStart(page: Page, skip: number, length: number): Promise<void> {
  230 |   // Клик у левого верхнего угла контента: не задевает виджеты-маркеры.
  231 |   await page.locator('.cm-content').click({ position: { x: 5, y: 8 } });
  232 |   await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  233 |   for (let i = 0; i < skip; i++) await page.keyboard.press('ArrowRight');
  234 |   for (let i = 0; i < length; i++) await page.keyboard.press('Shift+ArrowRight');
  235 | }
  236 | 
  237 | /** Клавиатурный путь выделение → flyout → попап: создаёт сигнал заданного типа. */
  238 | async function createSignalByKeyboard(
  239 |   page: Page,
  240 |   sidecarPath: string,
  241 |   selection: { skip: number; length: number },
  242 |   type: string,
  243 |   comment: string,
  244 | ): Promise<Review> {
  245 |   await selectFromStart(page, selection.skip, selection.length);
  246 |   const flyout = page.locator('[data-review-flyout]');
  247 |   await expect(flyout).toBeVisible();
  248 |   await page.keyboard.press('Tab');
  249 |   const firstType = flyout.getByRole('button', { name: 'Заметка', exact: true });
  250 |   await expect(firstType).toBeFocused();
  251 |   let focused = 'note';
  252 |   while (focused !== type) {
  253 |     await page.keyboard.press('Tab');
  254 |     const labels = ['note', 'change_required', 'warning', 'review'];
  255 |     focused = labels[(labels.indexOf(focused) + 1) % labels.length] as string;
  256 |   }
  257 |   await page.keyboard.press('Enter');
  258 |   const textarea = page.getByRole('textbox', { name: 'Комментарий сигнала' });
  259 |   await expect(textarea).toBeFocused();
  260 |   if (comment !== '') await textarea.fill(comment);
  261 |   await textarea.press('ControlOrMeta+Enter');
  262 |   return waitSidecar(page, sidecarPath, (review) =>
  263 |     review.signals.some((signal) => signal.type === type && signal.comment === comment));
  264 | }
  265 | 
  266 | test('заметка главы сохраняется в sidecar; при ошибке черновик остаётся', async () => {
  267 |   const bookRoot = await makeTempDir('galley-e2e-note-');
  268 |   await writeBook(bookRoot, emptyReview());
  269 |   const session = await launch(bookRoot);
  270 |   try {
  271 |     const page = session.page;
  272 |     await openOwnBook(session);
  273 |     const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
  274 | 
  275 |     await page.getByRole('button', { name: 'Заметка главы' }).click();
  276 |     const note = page.getByRole('textbox', { name: 'Текст заметки' });
  277 |     await note.fill('Глава требует вычитки');
  278 |     await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  279 |     const sidecar = await waitSidecar(page, sidecarPath, (review) => review.chapter_note !== '');
  280 |     expect(sidecar.chapter_note).toBe('Глава требует вычитки');
  281 | 
  282 |     // Ошибка сохранения: исходник исчезает, черновик заметки не сбрасывается.
  283 |     await page.getByRole('button', { name: 'Заметка главы' }).click();
  284 |     await note.fill('Глава требует вычитки и правки');
  285 |     await rm(path.join(bookRoot, CHAPTER_PATH));
  286 |     await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  287 |     await expect(page.getByRole('alert')).toBeVisible();
  288 |     await expect(note).toHaveValue('Глава требует вычитки и правки');
  289 |   } finally {
  290 |     await forceStop(session.app);
  291 |   }
  292 | });
  293 | 
  294 | test('черновик заметки главы не переезжает в другую главу', async () => {
  295 |   const bookRoot = await makeTempDir('galley-e2e-notekey-');
  296 |   await writeTwoChapterBook(bookRoot, emptyReview(), 'Заметка первой главы');
  297 |   const session = await launch(bookRoot);
  298 |   try {
  299 |     const page = session.page;
  300 |     await openOwnBook(session);
  301 |     const sidecarAPath = path.join(bookRoot, SIDECAR_PATH);
  302 |     const sidecarBPath = path.join(bookRoot, SIDECAR2_PATH);
  303 |     const sidecarABefore = await readFile(sidecarAPath, 'utf8');
  304 | 
  305 |     // Попап главы A: заметка видна, черновик правится, но не сохраняется.
  306 |     await page.getByRole('button', { name: 'Заметка главы' }).click();
  307 |     const noteA = page.getByRole('textbox', { name: 'Текст заметки' });
  308 |     await expect(noteA).toHaveValue('Заметка первой главы');
  309 |     await noteA.fill('Черновик главы A');
  310 | 
  311 |     // Смена главы закрывает попап: у главы B своя (пустая) заметка.
> 312 |     await page.getByRole('button', { name: 'Вторая', exact: true }).click();
      |                                                                     ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  313 |     await expect(page.getByRole('dialog', { name: 'Заметка главы' })).toHaveCount(0);
  314 |     await page.getByRole('button', { name: 'Заметка главы' }).click();
  315 |     const noteB = page.getByRole('textbox', { name: 'Текст заметки' });
  316 |     await expect(noteB).toHaveValue('');
  317 |     await noteB.fill('Заметка второй главы');
  318 |     await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  319 | 
  320 |     const sidecarB = await waitSidecar(page, sidecarBPath, (review) => review.chapter_note !== '');
  321 |     expect(sidecarB.chapter_note).toBe('Заметка второй главы');
  322 |     // Sidecar главы A не перезаписан: черновик A не доехал до главы B.
  323 |     expect(await readFile(sidecarAPath, 'utf8')).toBe(sidecarABefore);
  324 |   } finally {
  325 |     await session.app.close();
  326 |   }
  327 | });
  328 | 
  329 | test.afterEach(async () => {
  330 |   await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  331 | });
  332 | 
  333 | test('применение правки в «Сравнении» пишет обе пары, Отменить/Повторить восстанавливают байты', async () => {
  334 |   const review = fixtureReview();
  335 |   const source = new TextEncoder().encode(SOURCE_TEXT);
  336 |   const applied = applyEdit(openChapter(source, review), EDIT_ID);
  337 |   const bookRoot = await makeTempDir('galley-e2e-review-');
  338 |   await writeBook(bookRoot, review);
  339 |   const session = await launch(bookRoot);
  340 |   try {
  341 |     const page = session.page;
  342 |     await openOwnBook(session);
  343 |     const mdPath = path.join(bookRoot, CHAPTER_PATH);
  344 |     const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
  345 |     // До применения на диске ровно fixture-пара.
  346 |     expect(await readFile(mdPath, 'utf8')).toBe(SOURCE_TEXT);
  347 |     expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(review));
  348 | 
  349 |     await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
  350 |     await expect(page.locator('.book__comparison')).toContainText('кит');
  351 |     await page.getByRole('button', { name: 'Правка', exact: true }).first().click();
  352 |     const applyButton = page.getByRole('button', { name: 'Применить', exact: true });
  353 |     await expect(applyButton).toBeVisible();
  354 |     await applyButton.click();
  355 |     await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();
  356 |     // Обе реальные файлы равны применённой паре: правка ушла из sidecar,
  357 |     // независимый сигнал после заменённого диапазона перенесён якорем движка.
  358 |     const appliedText = new TextDecoder().decode(applied.source);
  359 |     expect(await readFile(mdPath, 'utf8')).toBe(appliedText);
  360 |     expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(applied.review));
  361 |     const appliedSidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as Review;
  362 |     expect(appliedSidecar.edits).toHaveLength(0);
  363 |     expect(appliedSidecar.signals).toHaveLength(1);
  364 | 
  365 |     await page.getByRole('button', { name: 'Отменить применение' }).click();
  366 |     await expect(page.getByRole('button', { name: 'Повторить применение' })).toBeEnabled();
  367 |     expect(await readFile(mdPath, 'utf8')).toBe(SOURCE_TEXT);
  368 |     expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(review));
  369 | 
  370 |     await page.getByRole('button', { name: 'Повторить применение' }).click();
  371 |     await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();
  372 |     expect(await readFile(mdPath, 'utf8')).toBe(appliedText);
  373 |     expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(applied.review));
  374 |   } finally {
  375 |     await session.app.close();
  376 |   }
  377 | });
  378 | 
  379 | test('клавиатурный путь выделение → flyout → попап создаёт сигнал с комментарием', async () => {
  380 |   const bookRoot = await makeTempDir('galley-e2e-signal-');
  381 |   await writeBook(bookRoot, emptyReview());
  382 |   const session = await launch(bookRoot);
  383 |   try {
  384 |     const page = session.page;
  385 |     await openOwnBook(session);
  386 |     const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
  387 |     const content = page.locator('.cm-content');
  388 | 
  389 |     await selectFromStart(page, 0, 3);
  390 |     const flyout = page.locator('[data-review-flyout]');
  391 |     await expect(flyout).toBeVisible();
  392 |     // Flyout не переносит фокус: копирование и навигация остаются в редакторе.
  393 |     await expect(content).toBeFocused();
  394 | 
  395 |     const sidecar = await createSignalByKeyboard(page, sidecarPath, { skip: 0, length: 3 }, 'note', 'Обсудить');
  396 |     const signal = sidecar.signals.find((candidate) => candidate.comment === 'Обсудить');
  397 |     expect(signal?.type).toBe('note');
  398 |     expect(signal?.selected_text).toBe('кот');
  399 |     // Маркер остаётся в gutter, комментарий — в панели и карточке.
  400 |     await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toBeVisible();
  401 |     await expect(page.locator('.gd-signal-comment')).toHaveCount(1);
  402 |     await expect(page.locator('.book__review')).toContainText('Обсудить');
  403 |     await page.getByRole('button', { name: 'Сигнал', exact: true }).click();
  404 |     await expect(page.getByRole('textbox', { name: 'Комментарий сигнала' })).toHaveValue('Обсудить');
  405 |   } finally {
  406 |     await session.app.close();
  407 |   }
  408 | });
  409 | 
  410 | test('Esc закрывает попап без создания сигнала и возвращает фокус в редактор', async () => {
  411 |   const bookRoot = await makeTempDir('galley-e2e-esc-');
  412 |   await writeBook(bookRoot, emptyReview());
```