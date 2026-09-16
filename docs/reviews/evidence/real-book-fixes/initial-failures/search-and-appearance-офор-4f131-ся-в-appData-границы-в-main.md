# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: search-and-appearance.spec.ts >> оформление: тема красит контейнер, настройки сохраняются в appData, границы в main
- Location: tests/desktop/search-and-appearance.spec.ts:260:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('tooltip', { name: 'До правки' })
Expected substring: "текст"
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('tooltip', { name: 'До правки' }) with timeout 10000ms
  - waiting for getByRole('tooltip', { name: 'До правки' })

```

```yaml
- banner:
  - img "Galley Desk"
  - text: galley-e2e-search-book-GC9EQz
  - button "Свернуть окно":
    - img
  - button "Развернуть окно":
    - img
  - button "Закрыть окно":
    - img
- banner:
  - heading "galley-e2e-search-book-GC9EQz" [level=1]
  - status "Сохранено"
  - button "Поиск по главе":
    - img
  - button "Текст" [pressed]:
    - img
  - button "Сравнение":
    - img
  - button "Исходник":
    - img
  - button "Режим Zen":
    - img
  - button "Меню книги":
    - img
- navigation "Оглавление":
  - heading "Оглавление" [level=2]
  - textbox "Фильтр глав":
    - /placeholder: Фильтр глав…
  - button "Глава 1 Глава 1.md"
- heading "Глава 1" [level=2]
- region "Метаданные главы":
  - text: Метаданные
  - button "Изменить метаданные":
    - img
    - text: Добавить
- button "Правка"
- textbox "Текст главы"
- complementary "Рецензия":
  - heading "Рецензия" [level=2]
  - button "Заметка главы"
  - navigation "Рецензия главы":
    - list:
      - listitem:
        - 'button "Правка: текст → правка"':
          - img
          - text: текст → правка
```

# Test source

```ts
  211 |     await page2.getByRole('button', { name: 'Заголовок' }).click();
  212 |     await expect(page2.locator('.cm-content')).toBeVisible();
  213 | 
  214 |     await page2.getByRole('button', { name: 'Сравнение' }).click();
  215 |     const comparison = page2.locator('.book__comparison');
  216 |     await expect(comparison).toContainText('кот-кит спит');
  217 | 
  218 |     // Запрос «кит» существует только во введённой части правки: переход
  219 |     // выделяет именно её (display-координаты через сегменты), а не удалённую.
  220 |     await page2.keyboard.press('Control+f');
  221 |     await page2.getByRole('textbox', { name: 'Поиск по главе' }).fill('кит');
  222 |     await expect(page2.locator('.book__search-counter')).toHaveText('1/1');
  223 |     await page2.getByRole('button', { name: 'Следующее совпадение' }).click();
  224 |     const selected = await page2.evaluate(() => window.getSelection()?.toString() ?? '');
  225 |     expect(selected).toBe('кит');
  226 |   } finally {
  227 |     await app.close();
  228 |   }
  229 | });
  230 | 
  231 | test('фильтр глав скрывает лишние записи и не меняет манифест', async () => {
  232 |   const session = await launchWithBook({
  233 |     'Медведь.md': 'текст\n',
  234 |     'Кит.md': 'текст\n',
  235 |     'Ёж.md': 'текст\n',
  236 |   });
  237 |   const { page, bookRoot, openByDialog } = session;
  238 |   try {
  239 |     await openByDialog();
  240 |     await expect(page.getByRole('button', { name: 'Медведь' })).toBeVisible();
  241 |     const manifestPath = path.join(bookRoot, '.pocket-editor.json');
  242 |     const before = await readFile(manifestPath, 'utf8');
  243 | 
  244 |     await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('кит');
  245 |     await expect(page.getByRole('button', { name: 'Кит' })).toBeVisible();
  246 |     await expect(page.getByRole('button', { name: 'Медведь' })).toHaveCount(0);
  247 |     await expect(page.getByRole('button', { name: 'Ёж' })).toHaveCount(0);
  248 |     await expect(page.getByText('Главы не найдены')).toHaveCount(0);
  249 | 
  250 |     await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('выдра');
  251 |     await expect(page.getByText('Главы не найдены')).toBeVisible();
  252 | 
  253 |     // Манифест на диске не менялся: фильтр живёт только в отображении.
  254 |     expect(await readFile(manifestPath, 'utf8')).toBe(before);
  255 |   } finally {
  256 |     await closeApp(session);
  257 |   }
  258 | });
  259 | 
  260 | test('оформление: тема красит контейнер, настройки сохраняются в appData, границы в main', async () => {
  261 |   const session = await launchWithBook({ 'Глава 1.md': 'текст\n' });
  262 |   const { page, userData, openByDialog } = session;
  263 |   try {
  264 |     await openByDialog();
  265 |     await expect(page.getByRole('button', { name: 'Глава 1' })).toBeVisible();
  266 | 
  267 |     await page.getByRole('button', { name: 'Меню книги' }).click();
  268 |     await page.getByRole('button', { name: 'Оформление' }).click();
  269 |     const themeSelect = page.getByLabel('Тема');
  270 |     await expect(themeSelect).toBeVisible();
  271 | 
  272 |     const bgBefore = await page.evaluate(
  273 |       () => getComputedStyle(document.querySelector('.book')!).getPropertyValue('--app-bg').trim(),
  274 |     );
  275 |     await themeSelect.selectOption('gruvbox-dark');
  276 |     const bgAfter = await page.evaluate(
  277 |       () => getComputedStyle(document.querySelector('.book')!).getPropertyValue('--app-bg').trim(),
  278 |     );
  279 |     expect(bgAfter).not.toBe(bgBefore);
  280 |     // Схема темы доезжает до контейнера (color-scheme).
  281 |     await expect
  282 |       .poll(() =>
  283 |         page.evaluate(() => getComputedStyle(document.querySelector('.book')!).getPropertyValue('color-scheme').trim()),
  284 |       )
  285 |       .toBe('dark');
  286 | 
  287 |     // Размер шрифта: значение уходит и в контейнер, и в appData.
  288 |     await page.getByLabel('Размер шрифта книги (10–48)').fill('20');
  289 |     await expect
  290 |       .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')!).fontSize))
  291 |       .toBe('20px');
  292 |     await expect
  293 |       .poll(async () => {
  294 |         const raw = await readFile(path.join(userData, 'settings.json'), 'utf8');
  295 |         const appearance = (JSON.parse(raw) as { appearance: { themeId: string; fontSize: number; fontFamily: string; lineWidth: number } }).appearance;
  296 |         return { themeId: appearance.themeId, fontSize: appearance.fontSize };
  297 |       })
  298 |       .toEqual({ themeId: 'gruvbox-dark', fontSize: 20 });
  299 | 
  300 |     // The passive editor preview uses interface typography, independently of book text.
  301 |     await page.getByLabel('Шрифт интерфейса', { exact: true }).fill('Georgia');
  302 |     await page.getByLabel('Размер интерфейса (10–24)').fill('18');
  303 |     await page.getByRole('button', { name: 'Закрыть оформление' }).click();
  304 |     const content = page.locator('.cm-content');
  305 |     await content.click({ position: { x: 5, y: 8 } });
  306 |     await page.keyboard.press('ControlOrMeta+Home');
  307 |     for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  308 |     await page.keyboard.type('правка');
  309 |     await expect(content).toContainText('правка');
  310 |     const preview = page.getByRole('tooltip', { name: 'До правки' });
> 311 |     await expect(preview).toContainText('текст');
      |                           ^ Error: expect(locator).toContainText(expected) failed
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
  407 |     await expect(page.getByRole('button', { name: 'Оформление', exact: true })).toBeFocused();
  408 |     await page.keyboard.press('Escape');
  409 |     await expect(page.getByRole('button', { name: 'Оформление', exact: true })).toHaveCount(0);
  410 |     await expect(page.getByRole('button', { name: 'Меню книги' })).toBeFocused();
  411 |   } finally { await closeApp(session); }
```