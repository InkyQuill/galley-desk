import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { openChapter } from '../../packages/review-engine/src/index';
import type { Review } from '../../packages/pocket-format/src/index';

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
    await session.page.keyboard.press('ControlOrMeta+a');
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
    await session.page.keyboard.press('ControlOrMeta+z');
    await expect(content).toContainText('кот спит.');
    await expect(session.page.getByText('Сохранено')).toBeVisible();

    // Redo возвращает правку (Shift+z синтезирует заглавную «Z» в key-имени).
    await session.page.keyboard.press('ControlOrMeta+Shift+Z');
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
    await session.page.keyboard.press('ControlOrMeta+z');
    await expect(session.page.locator('.cm-content')).toContainText('кит');
    expect(await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8')).toBe(sidecarBeforeUndo);
  } finally {
    await session.app.close();
  }
});

test('смена главы во время пачки ввода не переносит правки между главами', async () => {
  const bookRoot = await makeTempDir('galley-e2e-switch-race-');
  // Большая глава B: её открытие перестраивает движок заметно дольше кадра —
  // это «окно смены главы», в котором защищённое окно не показывает ни
  // одного редактора, а незащищённое показывает текст прежней главы.
  const bigB = 'пёс спит.\n' + 'текст '.repeat(180000);
  const manifest = {
    schema_version: 1,
    book_id: randomUUID(),
    title: 'Две главы',
    chapters: [
      { id: randomUUID(), path: 'Глава.md', title: 'Глава' },
      { id: randomUUID(), path: 'Вторая.md', title: 'Вторая' },
    ],
    ignored_files: [],
  };
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest, null, 2));
  const session = await launch(bookRoot, { 'Глава.md': 'кот спит.\n', 'Вторая.md': bigB });
  try {
    await openOwnBook(session);
    const content = session.page.locator('.cm-content');
    await expect(content).toContainText('кот спит.');

    // Пачка в главе A и немедленная смена главы: подтверждения продолжают
    // приходить уже после переключения — окно обязано их игнорировать.
    const burstA = 'abc'.repeat(10);
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    // insertText — одна атомарная вставка: одна команда с одним тяжёлым
    // сохранением двухмегабайтной главы — её ack живёт дольше смены главы.
    await session.page.keyboard.insertText(burstA);
    // CM виртуализирует строки большой главы: видимость хвоста пачки не
    // проверяем через innerText — точность докажет sidecar-проверка движком.
    await session.page.getByRole('button', { name: 'Вторая' }).click();

    // «Окно смены главы»: пока снимок B не пришёл, области ввода быть не
    // должно, а появившийся редактор обязан показывать только текст B —
    // текст прежней главы в окне B недопустим (иначе ввод ушёл бы в сессию
    // B по позициям текста A). Открывающаяся глава B большая: окно живёт
    // заметно дольше кадра, проба успевает его увидеть.
    const sweep = await session.page.evaluate(async () => {
      const seen: { count: number; head: string | null }[] = [];
      const deadline = performance.now() + 400;
      while (performance.now() < deadline) {
        const editors = document.querySelectorAll('.cm-content');
        const head = editors[0] ? (editors[0].textContent ?? '').slice(0, 24) : null;
        seen.push({ count: editors.length, head });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return seen;
    });
    // Каждый кадр окна: либо редактора ещё нет (снимок B не пришёл), либо
    // он уже показывает B. Текст A под именем B запрещён.
    const stale = sweep.find(
      (sample) => sample.count > 0 && (sample.head === null || !sample.head.startsWith('пёс спит.')),
    );
    expect(stale).toBeUndefined();
    await expect(content).toContainText('пёс спит.');

    // Ввод в главе B работает поверх стабильного документа.
    const burstB = 'xyzxyzxyzxyzx';
    await content.click();
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await session.page.keyboard.insertText(burstB);
    await expect(content).toContainText(burstB);

    // Тишина на диске по обоим sidecar.
    await waitSaveDrained(session.page, path.join(bookRoot, 'Глава.review.json'));
    await waitSaveDrained(session.page, path.join(bookRoot, 'Вторая.review.json'));

    // Основная истина на диске: закрытие дожидается очередей сохранения.
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    // Sidecar каждой главы содержит ровно правки своей главы: точный текст
    // движком (никакого переноса/смещения якорей и чужих символов).
    const sourceA = await readFile(path.join(bookRoot, 'Глава.md'));
    const sourceB = await readFile(path.join(bookRoot, 'Вторая.md'));
    const reviewA = JSON.parse(await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8')) as Review;
    expect(openChapter(sourceA, reviewA).text).toBe(`кот спит.\n${burstA}`);
    const reviewB = JSON.parse(await readFile(path.join(bookRoot, 'Вторая.review.json'), 'utf8')) as Review;
    expect(openChapter(sourceB, reviewB).text).toBe(`${bigB}${burstB}`);

    // Повторное открытие: в каждой главе ровно её собственный текст
    // (открывается последняя глава B — переходим в A явно; у большой главы
    // CM показывает только начало, точность хвостов проверена движком выше).
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.cm-content')).toBeVisible();
    await session.page.getByRole('button', { name: 'Глава', exact: true }).click();
    await expect(content).toContainText(`кот спит.${burstA}`);
    await session.page.getByRole('button', { name: 'Вторая' }).click();
    await expect(content).toContainText('пёс спит.');
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
    await session.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
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

// Chromium's native composition pipeline via CDP (not dispatchEvent).
// This deliberately does not claim OS input-method / candidate-window coverage.
test('Chromium composition commit/cancel and multiline emoji CRLF insertion survive reopen', async () => {
  const bookRoot = await makeTempDir('galley-e2e-composition-');
  const original = Buffer.from('original\r\n🦊\r\n');
  const session = await launch(bookRoot, { 'Глава.md': original });
  try {
    await openOwnBook(session);
    const page = session.page;
    const content = page.locator('.cm-content');
    const cdp = await page.context().newCDPSession(page);
    await content.click();
    await page.keyboard.press('ControlOrMeta+a');
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await cdp.send('Input.insertText', { text: '日本' });
    await expect(content).toContainText('日本');
    await cdp.send('Input.imeSetComposition', { text: 'cancel', selectionStart: 6, selectionEnd: 6 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await expect(content).not.toContainText('cancel');
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    const compositionReview = JSON.parse(await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8')) as Review;
    expect(openChapter(original, compositionReview).text).toBe('日本');
    expect(await readFile(path.join(bookRoot, 'Глава.md'))).toEqual(original);
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(content).toHaveText('日本');
    await expect(content).not.toContainText('cancel');
    // Exercise paste separately, after proving committed/canceled composition
    // survived the save queue and a fresh chapter load.
    await content.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('line one\r\nemoji 🦊\r\nlast');
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    const review = JSON.parse(await readFile(path.join(bookRoot, 'Глава.review.json'), 'utf8')) as Review;
    expect(openChapter(original, review).text).toBe('line one\nemoji 🦊\nlast');
    expect(await readFile(path.join(bookRoot, 'Глава.md'))).toEqual(original);
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(content).toContainText('emoji 🦊');
    await cdp.detach();
  } finally {
    await session.app.close();
  }
});
