# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: search-and-appearance.spec.ts >> поиск открывается с клавиатуры и Escape очищает запрос до закрытия
- Location: tests/desktop/search-and-appearance.spec.ts:389:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('button', { name: 'Оформление', exact: true })
Expected: focused
Received: inactive
Timeout:  10000ms

Call log:
  - Expect "toBeFocused" getByRole('button', { name: 'Оформление', exact: true }) with timeout 10000ms
  - waiting for getByRole('button', { name: 'Оформление', exact: true })
    24 × locator resolved to <button type="button">…</button>
       - unexpected value "inactive"

```

```yaml
- button "Оформление":
  - img
  - text: Оформление
```

# Test source

```ts
  307 |     for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  308 |     await page.keyboard.type('правка');
  309 |     await expect(content).toContainText('правка');
  310 |     const preview = page.getByRole('tooltip', { name: 'До правки' });
  311 |     await expect(preview).toContainText('текст');
  312 |     await expect(preview).toHaveCSS('font-size', '18px');
  313 |     await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Georgia');
  314 |     await expect(content).toHaveCSS('font-size', '20px');
  315 |     await expect(content).toBeFocused();
  316 | 
  317 |     // Границы проверяет main: неизвестная тема и fontSize вне 10–48 отвергаются.
  318 |     const unknownTheme = await page.evaluate(async () => {
  319 |       try {
  320 |         await window.desk.setAppearance({ themeId: 'night', fontFamily: 'Lora', fontSize: 16, lineWidth: 720 });
  321 |         return 'accepted';
  322 |       } catch (cause) {
  323 |         return (cause as Error).message;
  324 |       }
  325 |     });
  326 |     expect(unknownTheme).toContain('темы');
  327 |     const outOfBounds = await page.evaluate(async () => {
  328 |       try {
  329 |         await window.desk.setAppearance({ themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 999, lineWidth: 720 });
  330 |         return 'accepted';
  331 |       } catch (cause) {
  332 |         return (cause as Error).message;
  333 |       }
  334 |     });
  335 |     expect(outOfBounds).toContain('Размер шрифта');
  336 |   } finally {
  337 |     await closeApp(session);
  338 |   }
  339 | });
  340 | 
  341 | test('Zen: панели и topbar скрыты, Escape сначала закрывает popup, затем выходит', async () => {
  342 |   const chapterText = '# Заголовок\n\nкот спит на подоконнике.\n';
  343 |   const session = await launchWithBook({ 'Глава 1.md': chapterText });
  344 |   const { page, bookRoot, userData, openByDialog } = session;
  345 |   await openByDialog();
  346 |   await expect(page.getByRole('button', { name: 'Заголовок' })).toBeVisible();
  347 |   await closeApp(session);
  348 |   await writeEditSidecar(bookRoot, 'Глава 1.md', chapterText, 'кот спит', 'кит спит');
  349 | 
  350 |   const { app, page: zenPage } = await relaunch(userData);
  351 |   try {
  352 |     await zenPage.getByRole('button', { name: 'Открыть', exact: true }).click();
  353 |     await zenPage.getByRole('button', { name: 'Заголовок' }).click();
  354 |     await expect(zenPage.locator('.cm-content')).toBeVisible();
  355 | 
  356 |     // Вход в Zen: topbar/панели скрыты, выход виден всегда.
  357 |     await zenPage.getByRole('button', { name: 'Режим Zen' }).click();
  358 |     await expect(zenPage.locator('.book__header')).toHaveCount(0);
  359 |     await expect(zenPage.getByRole('navigation', { name: 'Оглавление' })).toHaveCount(0);
  360 |     await expect(zenPage.getByRole('complementary', { name: 'Рецензия' })).toHaveCount(0);
  361 |     await expect(zenPage.locator('.book__zen-exit')).toBeVisible();
  362 |     await expect(zenPage.locator('.cm-content')).toBeVisible();
  363 | 
  364 |     // Попап открывается и в Zen (клик по маркеру правки в тексте).
  365 |     await zenPage.getByRole('button', { name: 'Правка', exact: true }).first().click();
  366 |     const dialog = zenPage.getByRole('dialog', { name: 'Правка' });
  367 |     await expect(dialog).toBeVisible();
  368 | 
  369 |     // Первый Escape закрывает попап, Zen остаётся.
  370 |     await zenPage.keyboard.press('Escape');
  371 |     await expect(dialog).toHaveCount(0);
  372 |     await expect(zenPage.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
  373 |     await expect(zenPage.locator('.book__zen-exit')).toBeVisible();
  374 | 
  375 |     // Второй Escape выходит из Zen.
  376 |     await zenPage.keyboard.press('Escape');
  377 |     await expect(zenPage.locator('.book__header')).toBeVisible();
  378 | 
  379 |     // Постоянная кнопка выхода тоже работает.
  380 |     await zenPage.getByRole('button', { name: 'Режим Zen' }).click();
  381 |     await expect(zenPage.locator('.book__zen-exit')).toBeVisible();
  382 |     await zenPage.getByRole('button', { name: 'Выйти из Zen' }).click();
  383 |     await expect(zenPage.locator('.book__header')).toBeVisible();
  384 |   } finally {
  385 |     await app.close();
  386 |   }
  387 | });
  388 | 
  389 | test('поиск открывается с клавиатуры и Escape очищает запрос до закрытия', async () => {
  390 |   const session = await launchWithBook({ 'Глава.md': 'кот спит\n' });
  391 |   try {
  392 |     await session.openByDialog();
  393 |     const { page } = session;
  394 |     await expect(page.locator('.cm-content')).toBeVisible();
  395 |     const field = page.getByRole('textbox', { name: 'Поиск по главе' });
  396 |     await expect(field).toHaveCount(0);
  397 |     await page.keyboard.press('Control+f');
  398 |     await expect(field).toBeFocused();
  399 |     await field.fill('кот');
  400 |     await page.keyboard.press('Escape');
  401 |     await expect(field).toHaveValue('');
  402 |     await expect(field).toBeFocused();
  403 |     await page.keyboard.press('Escape');
  404 |     await expect(field).toHaveCount(0);
  405 |     await expect(page.getByRole('button', { name: 'Поиск по главе', exact: true })).toBeFocused();
  406 |     await page.getByRole('button', { name: 'Меню книги' }).click();
> 407 |     await expect(page.getByRole('button', { name: 'Оформление', exact: true })).toBeFocused();
      |                                                                                 ^ Error: expect(locator).toBeFocused() failed
  408 |     await page.keyboard.press('Escape');
  409 |     await expect(page.getByRole('button', { name: 'Оформление', exact: true })).toHaveCount(0);
  410 |     await expect(page.getByRole('button', { name: 'Меню книги' })).toBeFocused();
  411 |   } finally { await closeApp(session); }
  412 | });
  413 | 
  414 | test('размер книги не меняет интерфейс; оба локальных шрифта доступны с кириллицей', async () => {
  415 |   const session = await launchWithBook({ 'Глава.md': 'Кириллица: ёж и щука.\n' });
  416 |   try {
  417 |     await session.openByDialog();
  418 |     const { page } = session;
  419 |     await expect(page.locator('.cm-content')).toBeVisible();
  420 |     await page.getByRole('button', { name: 'Меню книги' }).click();
  421 |     await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  422 |     await page.getByLabel('Размер шрифта книги (10–48)').fill('26');
  423 |     await expect(page.locator('.cm-content')).toHaveCSS('font-size', '26px');
  424 |     await expect(page.locator('.book')).toHaveCSS('font-size', '13px');
  425 |     await page.getByLabel('Размер интерфейса (10–24)').fill('15');
  426 |     await expect(page.locator('.book')).toHaveCSS('font-size', '15px');
  427 |     await expect(page.locator('.cm-content')).toHaveCSS('font-size', '26px');
  428 |     const loaded = await page.evaluate(async () => {
  429 |       const ui = await document.fonts.load('13px Geist', 'Ёж');
  430 |       const book = await document.fonts.load('18px Literata', 'Щука');
  431 |       return [ui.length > 0, book.length > 0];
  432 |     });
  433 |     expect(loaded).toEqual([true, true]);
  434 |   } finally { await closeApp(session); }
  435 | });
  436 | 
  437 | 
  438 | test('Escape на кнопках поиска очищает запрос, закрывает поиск и лишь затем выходит из Zen', async () => {
  439 |   const session = await launchWithBook({ 'Глава.md': 'кот спит\n' });
  440 |   try {
  441 |     await session.openByDialog();
  442 |     const { page } = session;
  443 |     await expect(page.locator('.cm-content')).toBeVisible();
  444 |     await page.getByRole('button', { name: 'Режим Zen' }).click();
  445 |     await page.keyboard.press('Control+f');
  446 |     const field = page.getByRole('textbox', { name: 'Поиск по главе' });
  447 |     await field.fill('кот');
  448 |     await page.getByRole('button', { name: 'Следующее совпадение' }).focus();
  449 |     await page.keyboard.press('Escape');
  450 |     await expect(field).toHaveValue('');
  451 |     await page.getByRole('button', { name: 'Закрыть поиск' }).focus();
  452 |     await page.keyboard.press('Escape');
  453 |     await expect(field).toHaveCount(0);
  454 |     await expect(page.locator('.book__zen-exit')).toBeVisible();
  455 |     await page.keyboard.press('Escape');
  456 |     await expect(page.locator('.book__header')).toBeVisible();
  457 |   } finally { await closeApp(session); }
  458 | });
  459 | 
```