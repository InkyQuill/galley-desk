# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: review-actions.spec.ts >> delayed ACK maps highlighted support-prefix edit, gutter, preview and reveal together
- Location: tests/desktop/review-actions.spec.ts:988:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('.gd-review-gutter [data-record-id="4aa4077d-de35-407d-8efe-44807cc7aa8b"]')
Expected: "3"
Received: ""
Timeout:  10000ms

Call log:
  - Expect "toHaveAttribute" locator('.gd-review-gutter [data-record-id="4aa4077d-de35-407d-8efe-44807cc7aa8b"]') with timeout 10000ms
  - waiting for locator('.gd-review-gutter [data-record-id="4aa4077d-de35-407d-8efe-44807cc7aa8b"]')
    24 × locator resolved to <button type="button" aria-label="Правка" class="gd-record-marker" data-record-id="4aa4077d-de35-407d-8efe-44807cc7aa8b">…</button>
       - unexpected value "null"

```

```yaml
- button "Правка"
```

# Test source

```ts
  904  |     const trash = page.getByRole('button', { name: 'Удалённый текст', exact: true });
  905  |     await expect(trash).toBeVisible();
  906  |     await expect(trash).toHaveText('');
  907  |     await trash.hover();
  908  |     await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('DELETE');
  909  |     await trash.click();
  910  |     const popup = page.getByRole('dialog', { name: 'Правка', exact: true });
  911  |     await expect(popup).toBeVisible();
  912  |     await popup.hover();
  913  |     await page.waitForTimeout(300);
  914  |     await expect(popup).toBeVisible();
  915  |     await page.mouse.move(2, 2);
  916  |     await expect(popup).toHaveCount(0);
  917  |     await trash.click();
  918  |     await expect(popup).toBeVisible();
  919  |     await content.focus();
  920  |     await page.keyboard.press('ControlOrMeta+End');
  921  |     await expect(popup).toHaveCount(0);
  922  |     await trash.click();
  923  |     await expect(popup).toBeVisible();
  924  |     await page.getByRole('textbox', { name: 'Фильтр глав' }).click();
  925  |     await expect(popup).toHaveCount(0);
  926  |     await selectFromStart(page, 0, 0);
  927  |     await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
  928  |     await page.keyboard.press('ControlOrMeta+a');
  929  |     await page.keyboard.press('ControlOrMeta+c');
  930  |     const copied = await session.app.evaluate(({ clipboard }) => clipboard.readText());
  931  |     expect(copied).toBe(sourceText.replace('alpha', 'alphabeta').replace('DELETE ', ''));
  932  |     await page.keyboard.press('Escape');
  933  |     await selectFromStart(page, 0, 3);
  934  |     await page.locator('[data-review-flyout]').getByRole('button', { name: 'Заметка', exact: true }).click();
  935  |     const draft = page.getByRole('dialog', { name: 'Новый сигнал' });
  936  |     await draft.getByRole('textbox').fill('unsaved draft');
  937  |     await page.mouse.move(2, 2);
  938  |     await page.waitForTimeout(300);
  939  |     await expect(draft.getByRole('textbox')).toHaveValue('unsaved draft');
  940  |     expect((await draft.boundingBox())!.width).toBeGreaterThan(400);
  941  |     await page.screenshot({ path: '/tmp/galley-task3-signal-light.png' });
  942  |     await draft.getByRole('button', { name: 'Отмена' }).click();
  943  |     await expect(content).toBeFocused();
  944  |     await page.getByRole('button', { name: 'Меню книги' }).click();
  945  |     await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  946  |     await page.getByLabel('Тема', { exact: true }).selectOption('gruvbox-dark');
  947  |     await page.getByRole('button', { name: 'Закрыть оформление' }).click();
  948  |     await page.screenshot({ path: '/tmp/galley-task3-annotations-dark.png' });
  949  |     await annotations.first().click();
  950  |     const signalForm = page.getByRole('dialog', { name: 'Сигнал', exact: true });
  951  |     await signalForm.getByRole('textbox').fill('Long safe comment '.repeat(2000));
  952  |     await signalForm.getByRole('button', { name: 'Сохранить', exact: true }).click();
  953  |     await page.keyboard.press('Escape');
  954  |     const updatedComment = page.locator('.gd-signal-comment[data-record-id="00000000-0000-4000-8000-000000000001"]');
  955  |     await expect(updatedComment).toContainText('Long safe comment');
  956  |     await selectFromStart(page, 0, 0);
  957  |     await updatedComment.hover();
  958  |     const signalPreview = page.getByRole('tooltip', { name: 'Комментарий сигнала' });
  959  |     await expect(signalPreview).toContainText('Long safe comment');
  960  |     const bounds = await signalPreview.boundingBox();
  961  |     expect(bounds!.x).toBeGreaterThanOrEqual(0);
  962  |     expect(bounds!.y).toBeGreaterThanOrEqual(0);
  963  |     expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  964  |     await page.mouse.move(2, 2);
  965  |     await expect(signalPreview).toHaveCount(0);
  966  |   } finally { await session.app.close(); }
  967  | });
  968  |
  969  | async function holdReviewCommands(app: ElectronApplication): Promise<void> {
  970  |   await app.evaluate(({ ipcMain }) => {
  971  |     const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
  972  |     const original = handlers.get('desk:command')!;
  973  |     const state = globalThis as unknown as { releaseReview: () => void; reviewHeld: boolean };
  974  |     state.reviewHeld = false;
  975  |     const gate = new Promise<void>((resolve) => { state.releaseReview = resolve; });
  976  |     ipcMain.removeHandler('desk:command');
  977  |     ipcMain.handle('desk:command', async (...args) => {
  978  |       state.reviewHeld = true;
  979  |       await gate;
  980  |       return original(...args);
  981  |     });
  982  |   });
  983  | }
  984  | async function releaseReviewCommands(app: ElectronApplication): Promise<void> {
  985  |   await app.evaluate(() => (globalThis as unknown as { releaseReview?: () => void }).releaseReview?.());
  986  | }
  987  |
  988  | test('delayed ACK maps highlighted support-prefix edit, gutter, preview and reveal together', async () => {
  989  |   const bookRoot = await makeTempDir('galley-e2e-mapped-visual-');
  990  |   const id = randomUUID();
  991  |   const sourceText = 'abc trailing';
  992  |   await writeBook(bookRoot, { ...emptyReview(), edits: [{ id, before: 'abc', after: 'abXc', anchor: makeAnchor(Buffer.from(sourceText), { from: 0, to: 3 }) }] });
  993  |   await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  994  |   const session = await launch(bookRoot);
  995  |   try {
  996  |     const { page, app } = session;
  997  |     await openOwnBook(session);
  998  |     await holdReviewCommands(app);
  999  |     await selectFromStart(page, 1, 0);
  1000 |     await page.keyboard.insertText('Y');
  1001 |     await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld)).toBe(true);
  1002 |     const marker = page.locator(`.gd-review-gutter [data-record-id="${id}"]`);
  1003 |     await expect(page.locator('.gd-edit-range')).toHaveText('X');
> 1004 |     await expect(marker).toHaveAttribute('data-record-pos', '3');
       |                          ^ Error: expect(locator).toHaveAttribute(expected) failed
  1005 |     await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
  1006 |     await page.keyboard.press('ArrowRight'); // caret reaches the actual X at 3
  1007 |     await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('Добавление');
  1008 |     await page.getByRole('button', { name: /^Правка: abc/ }).click();
  1009 |     const selected = () => page.locator('.cm-content').evaluate((element) => {
  1010 |       const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
  1011 |       const selection = view.state.selection.main;
  1012 |       return { from: selection.from, to: selection.to, text: view.state.sliceDoc(selection.from, selection.to) };
  1013 |     });
  1014 |     expect(await selected()).toEqual({ from: 3, to: 4, text: 'X' });
  1015 |     await page.keyboard.press('Escape');
  1016 |     await releaseReviewCommands(app);
  1017 |     await expect(page.locator('.gd-edit-range')).toHaveText('YbX');
  1018 |     await expect(marker).toHaveAttribute('data-record-pos', '1');
  1019 |     await selectFromStart(page, 1, 0);
  1020 |     await expect(page.getByRole('tooltip', { name: 'До правки' }).locator('p')).toHaveText('b');
  1021 |     await page.getByRole('button', { name: /^Правка: abc/ }).click();
  1022 |     expect(await selected()).toEqual({ from: 1, to: 4, text: 'YbX' });
  1023 |   } finally { await releaseReviewCommands(session.app); await session.app.close(); }
  1024 | });
  1025 |
  1026 | test('delayed ACK keeps edit popup open for typing inside its live mapped range', async () => {
  1027 |   const bookRoot = await makeTempDir('galley-e2e-live-popup-');
  1028 |   const sourceText = 'abc trailing';
  1029 |   await writeBook(bookRoot, { ...emptyReview(), edits: [{ id: randomUUID(), before: 'abc', after: 'abXYZc', anchor: makeAnchor(Buffer.from(sourceText), { from: 0, to: 3 }) }] });
  1030 |   await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  1031 |   const session = await launch(bookRoot);
  1032 |   try {
  1033 |     const { page, app } = session;
  1034 |     await openOwnBook(session);
  1035 |     await holdReviewCommands(app);
  1036 |     await selectFromStart(page, 3, 0);
  1037 |     // Use the gutter to keep the insertion caret inside the visual range.
  1038 |     await page.locator('.gd-review-gutter .gd-record-marker').click();
  1039 |     const popup = page.getByRole('dialog', { name: 'Правка', exact: true });
  1040 |     await expect(popup).toBeVisible();
  1041 |     await page.locator('.cm-content').focus();
  1042 |     await page.keyboard.insertText('QQQQ');
  1043 |     await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld)).toBe(true);
  1044 |     await expect(page.locator('.gd-edit-range')).toHaveText('XQQQQYZ');
  1045 |     await page.waitForTimeout(100);
  1046 |     await expect(popup).toBeVisible();
  1047 |     await releaseReviewCommands(app);
  1048 |     await waitSaveDrained(page, path.join(bookRoot, SIDECAR_PATH));
  1049 |     await expect(popup).toBeVisible();
  1050 |     await page.keyboard.press('ControlOrMeta+End');
  1051 |     await expect(popup).toHaveCount(0);
  1052 |   } finally { await releaseReviewCommands(session.app); await session.app.close(); }
  1053 | });
  1054 |
  1055 | for (const to of [4, 5]) {
  1056 |   test(`paragraph annotation stays before the next paragraph when selection ends at ${to}`, async () => {
  1057 |     const bookRoot = await makeTempDir('galley-e2e-paragraph-comment-');
  1058 |     const sourceText = 'one\n\nTwo';
  1059 |     await writeBook(bookRoot, { ...emptyReview(), signals: [{ id: randomUUID(), type: 'note', selected_text: sourceText.slice(0, to), comment: 'First paragraph note', anchor: makeAnchor(Buffer.from(sourceText), { from: 0, to }) }] });
  1060 |     await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  1061 |     const session = await launch(bookRoot);
  1062 |     try {
  1063 |       const { page } = session;
  1064 |       await openOwnBook(session);
  1065 |       const first = await page.locator('.cm-line').filter({ hasText: /^one$/ }).boundingBox();
  1066 |       const next = await page.locator('.cm-line').filter({ hasText: /^Two$/ }).boundingBox();
  1067 |       const comment = await page.locator('.gd-signal-comment').boundingBox();
  1068 |       expect(comment!.y).toBeGreaterThan(first!.y);
  1069 |       expect(comment!.y + comment!.height).toBeLessThanOrEqual(next!.y);
  1070 |       expect(await readFile(path.join(bookRoot, CHAPTER_PATH), 'utf8')).toBe(sourceText);
  1071 |     } finally { await session.app.close(); }
  1072 |   });
  1073 | }
  1074 |
```
