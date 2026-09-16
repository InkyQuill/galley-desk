import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeReview, makeAnchor } from '@galley-desk/pocket-format';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

async function launch(
  bookRoot: string,
  files: Record<string, Buffer | string> = {},
): Promise<Session> {
  const userData = await makeTempDir('galley-userdata-');
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, userData, bookRoot };
}

async function stubDialog(app: ElectronApplication, result: { canceled: boolean; filePaths?: string[] }): Promise<void> {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showOpenDialog = async () => payload as { canceled: boolean; filePaths: string[] };
  }, result);
}

async function openOwnBook(session: Session): Promise<void> {
  await stubDialog(session.app, { canceled: false, filePaths: [session.bookRoot] });
  await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(session.page.locator('.cm-content')).toBeVisible();
}

/** Дожидается завершения сохранения: sidecar на диске перестаёт меняться. */
async function waitSaveDrained(page: Page, sidecarPath: string): Promise<void> {
  let previous = '';
  try {
    previous = await readFile(sidecarPath, 'utf8');
  } catch {
    previous = '';
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.waitForTimeout(250);
    let current: string;
    try {
      current = await readFile(sidecarPath, 'utf8');
    } catch {
      current = '';
    }
    if (current !== '' && current === previous) return;
    previous = current;
  }
  throw new Error(`Сохранение не завершилось: ${sidecarPath}`);
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('внешнее изменение принимается: чужая версия в редакторе, локальные правки не затёрты', async () => {
  const bookRoot = await makeTempDir('galley-e2e-external-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  try {
    await openOwnBook(session);
    const content = session.page.locator('.cm-content');
    await expect(content).toContainText('кот');

    // Локальная правка сохраняется в sidecar…
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.type('!');
    await expect(content).toContainText('кот!');
    await expect(session.page.getByText('Сохранено')).toBeVisible();
    // …и снимается Undo-ом, чтобы sidecar остался без правок: внешний текст
    // после принятия не искажается переносами старых правок.
    await session.page.keyboard.press('ControlOrMeta+z');
    // Substring 'кот' also matches the pre-undo 'кот!'; await the actual
    // committed undo before racing a foreign source write against the session.
    await expect(content).toHaveText('кот');
    await expect.poll(async () => JSON.parse(await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8')).edits).toEqual([]);
    await expect(session.page.getByText('Сохранено')).toBeVisible();

    // Внешняя правка выполняется мимо приложения.
    await writeFile(path.join(bookRoot, 'Глава.md'), 'внешний текст', 'utf8');

    // Наблюдатель только сигнализирует; проверка выполняет сессия. После
    // принятия внешняя версия замещает документ без перезапуска.
    await expect(content).toContainText('внешний текст', { timeout: 20_000 });
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('внешний текст');
    await expect(session.page.getByText('Сохранено')).toBeVisible();

    // Ввод продолжается поверх внешней версии; правки идут только в sidecar.
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.type('!');
    await expect(content).toContainText('внешний текст!');
    await expect(session.page.getByText('Сохранено')).toBeVisible();
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('внешний текст');
  } finally {
    await session.app.close();
  }
});

test('STALE_REVISION при внешнем изменении не маскируется под «Ошибка сохранения»', async () => {
  const bookRoot = await makeTempDir('galley-e2e-external-chip-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  const sourcePath = path.join(bookRoot, 'Глава.md');
  try {
    await openOwnBook(session);
    const content = session.page.locator('.cm-content');
    await expect(content).toContainText('кот');

    // Шаг 1: настоящий сбой записи (каталог книги только для чтения) —
    // сессия переходит в 'error', чип «Ошибка сохранения» уместен.
    await chmod(bookRoot, 0o555);
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.type('?');
    await expect(session.page.getByText('Ошибка сохранения')).toBeVisible();
    await expect(session.page.getByRole('alert')).toContainText('локальный текст сохранён');
    await chmod(bookRoot, 0o755);

    // Шаг 2: чужая версия на диске; ожидающая работа уходит в черновик
    // (appData), сессия переходит в 'external'. Локальный флаг сбоя ещё
    // держит чип «Ошибка сохранения» (снимок сбоя не прячется молча).
    await writeFile(sourcePath, 'чужая версия', 'utf8');
    await expect(
      session.page.getByRole('button', { name: 'Открыть внешнюю версию' }),
    ).toBeVisible({ timeout: 20_000 });

    // Шаг 3: «Перечитать главу» снимает локальный флаг; теперь чип —
    // аффорданс внешнего изменения.
    await session.page.getByRole('button', { name: 'Перечитать главу' }).click();
    await expect(session.page.getByText('Внешнее изменение')).toBeVisible();
    await expect(session.page.getByRole('button', { name: 'Открыть внешнюю версию' })).toBeVisible();

    // Шаг 4: ввод при неразрешённом внешнем изменении отклоняется
    // (STALE_REVISION). Чип обязан остаться аффордансом внешнего изменения,
    // а не превращаться в «Ошибка сохранения» с «Перечитать главу».
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.type('#');
    // Отказ команды обработан очередью: синхронизируемся на его алерте,
    // прежде чем судить о стабильном состоянии чипа.
    await expect(session.page.getByRole('alert')).toContainText('локальный текст сохранён', { timeout: 10_000 });
    await expect(session.page.getByText('Внешнее изменение')).toBeVisible();
    await expect(session.page.getByText('Ошибка сохранения')).toHaveCount(0);
    await expect(session.page.getByRole('button', { name: 'Перечитать главу' })).toHaveCount(0);

    // Правильный аффорданс работает: явное разрешение принимает чужую базу.
    await session.page.getByRole('button', { name: 'Открыть внешнюю версию' }).click();
    await expect(content).toContainText('чужая версия', { timeout: 20_000 });
    await expect(session.page.getByText('Сохранено')).toBeVisible();
  } finally {
    await session.app.close();
  }
});

test('сбой сохранения сохраняет локальный текст; чужая версия не перезаписывается', async () => {
  const bookRoot = await makeTempDir('galley-e2e-failsave-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  try {
    await openOwnBook(session);
    const content = session.page.locator('.cm-content');
    await expect(content).toContainText('кот');

    // Правка и откат: sidecar остаётся без правок.
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.type('!');
    await expect(content).toContainText('кот!');
    await session.page.keyboard.press('ControlOrMeta+z');
    await expect(content).toContainText('кот');
    await expect(session.page.getByText('Сохранено')).toBeVisible();

    // Удаление только после того, как запись undo завершилась: иначе rm
    // гоняет запись и тест перестаёт быть детерминированным.
    await waitSaveDrained(session.page, path.join(bookRoot, 'Глава.review.json'));
    // Исходник исчезает: следующая запись падает.
    await rm(path.join(bookRoot, 'Глава.md'));
    await session.page.keyboard.type('?');
    await expect(session.page.getByRole('alert')).toContainText('локальный текст сохранён');
    // Статус «Ошибка сохранения», локальный текст остаётся в редакторе.
    await expect(session.page.getByText('Ошибка сохранения')).toBeVisible();
    await expect(content).toContainText('кот?');
    // Файл не создан «с лучшей надеждой»: приложение ничего не записало.
    await expect(readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).rejects.toThrow();

    // Чужая версия появляется на диске: наблюдатель выполняет проверку, но
    // авто-затирания нет — локальный текст, ошибка и «Перечитать главу»
    // остаются, пока пользователь явно не выберет внешнюю базу.
    await writeFile(path.join(bookRoot, 'Глава.md'), 'чужая версия', 'utf8');
    await expect(content).toContainText('кот?', { timeout: 20_000 });
    await expect(session.page.getByRole('alert')).toContainText('локальный текст сохранён');
    await expect(session.page.getByText('Ошибка сохранения')).toBeVisible();
    await expect(session.page.getByRole('button', { name: 'Перечитать главу' })).toBeVisible();
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');

    // Явный выбор «Перечитать главу» принимает внешнюю базу в редакторе.
    await session.page.getByRole('button', { name: 'Перечитать главу' }).click();
    await expect(content).toContainText('чужая версия', { timeout: 20_000 });
    await expect(session.page.getByText('Сохранено')).toBeVisible();
    await expect(session.page.getByRole('alert')).toHaveCount(0);

    // После явного принятия ввод снова работает поверх внешней версии.
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.type('!');
    await expect(content).toContainText('чужая версия!');
    await expect(session.page.getByText('Сохранено')).toBeVisible();
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');
  } finally {
    await session.app.close();
  }
});

test('recovery conflict blocks input and preserves local pair before explicit acceptance', async () => {
  const { createHash, randomUUID } = await import('node:crypto');
  const { readdir } = await import('node:fs/promises');
  const bookRoot = await makeTempDir('galley-e2e-recovery-');
  const bookId = randomUUID();
  const chapterId = randomUUID();
  const session = await launch(bookRoot, {
    '01.md': 'external fox',
    '.pocket-editor.json': JSON.stringify({ schema_version: 1, book_id: bookId, title: 'Recovery', chapters: [{ id: chapterId, path: '01.md', title: 'One' }], ignored_files: [] }),
  });
  try {
    const bytes = (text: string) => ({ base64: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex') });
    const review = encodeReview({ schema_version: 1, chapter_id: chapterId, source_path: '01.md', chapter_note: 'local note', edits: [], signals: [{ id: randomUUID(), type: 'note', selected_text: 'dog', comment: 'local signal', anchor: makeAnchor(Buffer.from('local dog'), { from: 6, to: 9 }) }] });
    const record = { version: 1, root: bookRoot, chapter_id: chapterId, source_path: '01.md', review_path: '01.review.json', complete: false, before: { source: bytes('cat'), review: null }, after: { source: bytes('local dog'), review: bytes(review) } };
    const name = `galley-journal-${createHash('sha256').update(`${bookRoot}\n${chapterId}`).digest('hex').slice(0, 32)}.json`;
    await writeFile(path.join(session.userData, name), JSON.stringify(record));
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('alert')).toContainText('Восстановление приостановлено');
    await expect(session.page.getByLabel('Локальная версия восстановления')).toHaveText('local dog');
    await expect(session.page.locator('.cm-content')).toHaveCount(0);
    await session.page.getByRole('button', { name: 'Заметка главы', exact: true }).click();
    await expect(session.page.getByRole('textbox', { name: 'Текст заметки' })).toHaveAttribute('readonly', '');
    await expect(session.page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await session.page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await session.page.getByRole('button', { name: 'Сигнал [note]: local signal', exact: true }).click();
    await expect(session.page.getByRole('textbox', { name: 'Комментарий сигнала' })).toHaveAttribute('readonly', '');
    await expect(session.page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(session.page.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled();
    await expect(session.page.getByRole('button', { name: 'Предупреждение', exact: true })).toBeDisabled();
    expect(JSON.parse(await readFile(path.join(session.userData, name), 'utf8'))).toEqual(record);
    expect(await readFile(path.join(bookRoot, '01.md'), 'utf8')).toBe('external fox');
    await session.page.getByRole('button', { name: 'Открыть внешнюю версию' }).click();
    await expect(session.page.locator('.cm-content')).toContainText('external fox');
    await expect(session.page.getByText('Сохранено')).toBeVisible();
    const backups = path.join(session.userData, 'recovery-backups');
    const [backup] = await readdir(backups);
    expect(await readFile(path.join(backups, backup!, '01.md'), 'utf8')).toBe('local dog');
    expect(JSON.parse(await readFile(path.join(backups, backup!, 'recovery-journal.json'), 'utf8'))).toEqual(record);
    await expect(readFile(path.join(session.userData, name))).rejects.toThrow();
  } finally { await session.app.close(); }
});
