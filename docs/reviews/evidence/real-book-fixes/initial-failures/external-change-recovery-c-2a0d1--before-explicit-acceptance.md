# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: external-change.spec.ts >> recovery conflict blocks input and preserves local pair before explicit acceptance
- Location: tests/desktop/external-change.spec.ts:228:1

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator: getByRole('button', { name: 'warning', exact: true })
Expected: disabled
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeDisabled" getByRole('button', { name: 'warning', exact: true }) with timeout 10000ms
  - waiting for getByRole('button', { name: 'warning', exact: true })

```

```yaml
- banner:
  - img "Galley Desk"
  - text: Recovery
  - button "Свернуть окно":
    - img
  - button "Развернуть окно":
    - img
  - button "Закрыть окно":
    - img
- banner:
  - heading "Recovery" [level=1]
  - status "Только чтение"
  - alert: "Только чтение: Восстановление приостановлено. Сохраните локальную пару или откройте внешнюю версию."
  - text: Восстановление приостановлено. Локальная пара сохранена в журнале. Открытие внешней версии сохранит резервную копию; экспорт сохранит копию главы в новую папку и откроет внешнюю версию.
  - button "Открыть внешнюю версию"
  - button "Экспортировать копию главы…"
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
  - button "One 01.md"
- heading "One" [level=2]
- region "Метаданные главы":
  - text: Метаданные
  - button "Изменить метаданные" [disabled]:
    - img
    - text: Добавить
- text: local dog
- complementary "Рецензия":
  - heading "Рецензия" [level=2]
  - button "Заметка главы"
  - navigation "Рецензия главы":
    - list:
      - listitem:
        - 'button "Сигнал [note]: local signal" [expanded]':
          - img
          - text: local signal
        - dialog "Сигнал":
          - strong: "Сигнал: Заметка"
          - button "Заметка" [disabled] [pressed]
          - button "Требуется правка" [disabled]
          - button "Предупреждение" [disabled]
          - button "На проверку" [disabled]
          - textbox "Комментарий сигнала":
            - /placeholder: Комментарий (необязательно)
            - text: local signal
          - button "Сохранить" [disabled]
          - button "Отмена"
          - button "Удалить" [disabled]
```

# Test source

```ts
  157 |     await expect(session.page.getByText('Внешнее изменение')).toBeVisible();
  158 |     await expect(session.page.getByText('Ошибка сохранения')).toHaveCount(0);
  159 |     await expect(session.page.getByRole('button', { name: 'Перечитать главу' })).toHaveCount(0);
  160 | 
  161 |     // Правильный аффорданс работает: явное разрешение принимает чужую базу.
  162 |     await session.page.getByRole('button', { name: 'Открыть внешнюю версию' }).click();
  163 |     await expect(content).toContainText('чужая версия', { timeout: 20_000 });
  164 |     await expect(session.page.getByText('Сохранено')).toBeVisible();
  165 |   } finally {
  166 |     await session.app.close();
  167 |   }
  168 | });
  169 | 
  170 | test('сбой сохранения сохраняет локальный текст; чужая версия не перезаписывается', async () => {
  171 |   const bookRoot = await makeTempDir('galley-e2e-failsave-');
  172 |   const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  173 |   try {
  174 |     await openOwnBook(session);
  175 |     const content = session.page.locator('.cm-content');
  176 |     await expect(content).toContainText('кот');
  177 | 
  178 |     // Правка и откат: sidecar остаётся без правок.
  179 |     await content.click();
  180 |     await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  181 |     await session.page.keyboard.type('!');
  182 |     await expect(content).toContainText('кот!');
  183 |     await session.page.keyboard.press('ControlOrMeta+z');
  184 |     await expect(content).toContainText('кот');
  185 |     await expect(session.page.getByText('Сохранено')).toBeVisible();
  186 | 
  187 |     // Удаление только после того, как запись undo завершилась: иначе rm
  188 |     // гоняет запись и тест перестаёт быть детерминированным.
  189 |     await waitSaveDrained(session.page, path.join(bookRoot, 'Глава.review.json'));
  190 |     // Исходник исчезает: следующая запись падает.
  191 |     await rm(path.join(bookRoot, 'Глава.md'));
  192 |     await session.page.keyboard.type('?');
  193 |     await expect(session.page.getByRole('alert')).toContainText('локальный текст сохранён');
  194 |     // Статус «Ошибка сохранения», локальный текст остаётся в редакторе.
  195 |     await expect(session.page.getByText('Ошибка сохранения')).toBeVisible();
  196 |     await expect(content).toContainText('кот?');
  197 |     // Файл не создан «с лучшей надеждой»: приложение ничего не записало.
  198 |     await expect(readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).rejects.toThrow();
  199 | 
  200 |     // Чужая версия появляется на диске: наблюдатель выполняет проверку, но
  201 |     // авто-затирания нет — локальный текст, ошибка и «Перечитать главу»
  202 |     // остаются, пока пользователь явно не выберет внешнюю базу.
  203 |     await writeFile(path.join(bookRoot, 'Глава.md'), 'чужая версия', 'utf8');
  204 |     await expect(content).toContainText('кот?', { timeout: 20_000 });
  205 |     await expect(session.page.getByRole('alert')).toContainText('локальный текст сохранён');
  206 |     await expect(session.page.getByText('Ошибка сохранения')).toBeVisible();
  207 |     await expect(session.page.getByRole('button', { name: 'Перечитать главу' })).toBeVisible();
  208 |     expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');
  209 | 
  210 |     // Явный выбор «Перечитать главу» принимает внешнюю базу в редакторе.
  211 |     await session.page.getByRole('button', { name: 'Перечитать главу' }).click();
  212 |     await expect(content).toContainText('чужая версия', { timeout: 20_000 });
  213 |     await expect(session.page.getByText('Сохранено')).toBeVisible();
  214 |     await expect(session.page.getByRole('alert')).toHaveCount(0);
  215 | 
  216 |     // После явного принятия ввод снова работает поверх внешней версии.
  217 |     await content.click();
  218 |     await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  219 |     await session.page.keyboard.type('!');
  220 |     await expect(content).toContainText('чужая версия!');
  221 |     await expect(session.page.getByText('Сохранено')).toBeVisible();
  222 |     expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');
  223 |   } finally {
  224 |     await session.app.close();
  225 |   }
  226 | });
  227 | 
  228 | test('recovery conflict blocks input and preserves local pair before explicit acceptance', async () => {
  229 |   const { createHash, randomUUID } = await import('node:crypto');
  230 |   const { readdir } = await import('node:fs/promises');
  231 |   const bookRoot = await makeTempDir('galley-e2e-recovery-');
  232 |   const bookId = randomUUID();
  233 |   const chapterId = randomUUID();
  234 |   const session = await launch(bookRoot, {
  235 |     '01.md': 'external fox',
  236 |     '.pocket-editor.json': JSON.stringify({ schema_version: 1, book_id: bookId, title: 'Recovery', chapters: [{ id: chapterId, path: '01.md', title: 'One' }], ignored_files: [] }),
  237 |   });
  238 |   try {
  239 |     const bytes = (text: string) => ({ base64: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex') });
  240 |     const review = encodeReview({ schema_version: 1, chapter_id: chapterId, source_path: '01.md', chapter_note: 'local note', edits: [], signals: [{ id: randomUUID(), type: 'note', selected_text: 'dog', comment: 'local signal', anchor: makeAnchor(Buffer.from('local dog'), { from: 6, to: 9 }) }] });
  241 |     const record = { version: 1, root: bookRoot, chapter_id: chapterId, source_path: '01.md', review_path: '01.review.json', complete: false, before: { source: bytes('cat'), review: null }, after: { source: bytes('local dog'), review: bytes(review) } };
  242 |     const name = `galley-journal-${createHash('sha256').update(`${bookRoot}\n${chapterId}`).digest('hex').slice(0, 32)}.json`;
  243 |     await writeFile(path.join(session.userData, name), JSON.stringify(record));
  244 |     await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
  245 |     await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
  246 |     await expect(session.page.getByRole('alert')).toContainText('Восстановление приостановлено');
  247 |     await expect(session.page.getByLabel('Локальная версия восстановления')).toHaveText('local dog');
  248 |     await expect(session.page.locator('.cm-content')).toHaveCount(0);
  249 |     await session.page.getByRole('button', { name: 'Заметка главы', exact: true }).click();
  250 |     await expect(session.page.getByRole('textbox', { name: 'Текст заметки' })).toHaveAttribute('readonly', '');
  251 |     await expect(session.page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  252 |     await session.page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  253 |     await session.page.getByRole('button', { name: 'Сигнал [note]: local signal', exact: true }).click();
  254 |     await expect(session.page.getByRole('textbox', { name: 'Комментарий сигнала' })).toHaveAttribute('readonly', '');
  255 |     await expect(session.page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  256 |     await expect(session.page.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled();
> 257 |     await expect(session.page.getByRole('button', { name: 'warning', exact: true })).toBeDisabled();
      |                                                                                      ^ Error: expect(locator).toBeDisabled() failed
  258 |     expect(JSON.parse(await readFile(path.join(session.userData, name), 'utf8'))).toEqual(record);
  259 |     expect(await readFile(path.join(bookRoot, '01.md'), 'utf8')).toBe('external fox');
  260 |     await session.page.getByRole('button', { name: 'Открыть внешнюю версию' }).click();
  261 |     await expect(session.page.locator('.cm-content')).toContainText('external fox');
  262 |     await expect(session.page.getByText('Сохранено')).toBeVisible();
  263 |     const backups = path.join(session.userData, 'recovery-backups');
  264 |     const [backup] = await readdir(backups);
  265 |     expect(await readFile(path.join(backups, backup!, '01.md'), 'utf8')).toBe('local dog');
  266 |     expect(JSON.parse(await readFile(path.join(backups, backup!, 'recovery-journal.json'), 'utf8'))).toEqual(record);
  267 |     await expect(readFile(path.join(session.userData, name))).rejects.toThrow();
  268 |   } finally { await session.app.close(); }
  269 | });
  270 | 
```