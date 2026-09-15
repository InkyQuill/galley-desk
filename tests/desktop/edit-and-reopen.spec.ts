import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

/** Отдельные temp book и temp userData на каждый тест (как в open-book.spec). */
async function launch(
  bookRoot: string,
  files: Record<string, Buffer | string> = {},
  explicitUserData?: string,
): Promise<Session> {
  const userData = explicitUserData ?? (await makeTempDir('galley-userdata-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  // Ошибки основного процесса (стабильные коды) видны в логе теста.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes('[desk]')) process.stdout.write(`[main] ${text}`);
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
async function waitSaveDrained(page: Page, sidecarPath: string): Promise<string> {
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
    if (current !== '' && current === previous) return current;
    previous = current;
  }
  throw new Error(`Сохранение не завершилось: ${sidecarPath}`);
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('ввод кот→кит пишет sidecar, исходник цел, после открытия — кит и пустой Undo', async () => {
  const bookRoot = await makeTempDir('galley-e2e-edit-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот спит.\n' });
  try {
    await openOwnBook(session);
    const content = session.page.locator('.cm-content');
    await expect(content).toContainText('кот спит.');

    // Замена кот спит. → кит одним вводом поверх выделения всего текста.
    await content.click();
    await session.page.keyboard.press('Control+a');
    await session.page.keyboard.type('кит');
    await expect(content).toContainText('кит');
    await expect(session.page.getByText('Сохранено')).toBeVisible();
    // Дожидаемся тишины на диске: нажатия Undo не пересекаются с пачкой.
    await waitSaveDrained(session.page, path.join(bookRoot, 'Глава.review.json'));

    // Исходный Markdown не меняется, правка живёт в sidecar.
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('кот спит.\n');
    const sidecar = await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8');
    expect(sidecar).toContain('"after": "кит"');

    // Undo в «Тексте» — это undo-input: один шаг снимает весь ввод.
    await session.page.keyboard.press('Control+z');
    await expect(content).toContainText('кот спит.');
    await expect(session.page.getByText('Сохранено')).toBeVisible();

    // Redo возвращает правку (Shift+z синтезирует заглавную «Z» в key-имени).
    await session.page.keyboard.press('Control+Shift+Z');
    await expect(content).toContainText('кит');

    // Закрытие книги дожидается очереди сохранения.
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('кот спит.\n');

    // Повторное открытие: кит восстановлен, Undo пуст — Ctrl+Z ничего не меняет.
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.cm-content')).toContainText('кит');
    const sidecarBeforeUndo = await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8');
    await session.page.locator('.cm-content').click();
    await session.page.keyboard.press('Control+z');
    await expect(session.page.locator('.cm-content')).toContainText('кит');
    expect(await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8')).toBe(sidecarBeforeUndo);
  } finally {
    await session.app.close();
  }
});

test('быстрый ввод 50 транзакций не теряет и не дублирует символы', async () => {
  const bookRoot = await makeTempDir('galley-e2e-burst-');
  const session = await launch(bookRoot, { 'Глава.md': 'Текст\n' });
  try {
    await openOwnBook(session);
    const content = session.page.locator('.cm-content');
    await expect(content).toContainText('Текст');

    // 50 быстрых нажатий — 50 транзакций и команд в FIFO при задержанных ack.
    const burst = 'qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxc';
    await content.click();
    await session.page.keyboard.press('Control+End');
    await session.page.keyboard.type(burst, { delay: 5 });
    await expect(content).toContainText(burst);

    const sidecar = await waitSaveDrained(session.page, path.join(bookRoot, 'Глава.review.json'));
    expect(sidecar.length).toBeGreaterThan(0);

    // Основная истина на диске: закрытие и повторное открытие книги.
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.cm-content')).toContainText(`Текст${burst}`);
    const restored = await session.page.locator('.cm-content').innerText();
    // Ровно один хвост пачки: ничего не потеряно и не задублировано.
    expect(restored.replace(/\n/g, '')).toBe(`Текст${burst}`);
  } finally {
    await session.app.close();
  }
});
