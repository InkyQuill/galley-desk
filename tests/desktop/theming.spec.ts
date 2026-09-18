// Electron-тесты темизации всего приложения: экран недавних красится темой
// из настроек, «Системная» следует за живой сменой схемы ОС, семантические
// токены ошибок доезжают до утилитарных классов. Запуск — по собранному
// Forge-входу (.vite/build): сначала `npm run package`.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { getTheme, themeToCssVariables } from '@inkyquill/galley-themes';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Значение токена темы в rgb-виде, как его сериализует getComputedStyle. */
function themeTokenRgb(themeId: string, token: string): string {
  const value = themeToCssVariables(getTheme(themeId))[token] as string;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim());
  if (hex === null) throw new Error(`Токен ${token} темы ${themeId} не hex-цвет: ${value}`);
  return `rgb(${Number.parseInt(hex[1]!, 16)}, ${Number.parseInt(hex[2]!, 16)}, ${Number.parseInt(hex[3]!, 16)})`;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

/** Temp book + temp userData с предзаписанным блоком appearance настроек. */
async function launchWithSettings(appearance: Record<string, unknown>): Promise<Session> {
  const bookRoot = await makeTempDir('galley-e2e-theming-book-');
  const userData = await makeTempDir('galley-e2e-theming-user-');
  await writeFile(
    path.join(bookRoot, 'Глава 1.md'),
    '# Глава первая\n\nкот спит на подоконнике.\n',
    'utf8',
  );
  await writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      appearance: { themeId: 'auto', fontFamily: 'system-ui', fontSize: 16, lineWidth: 720, ...appearance },
      positions: {},
    }),
    'utf8',
  );
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  return { app, page, userData, bookRoot };
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface RootSnapshot {
  bgVar: string;
  bgColor: string;
  colorScheme: string;
  dataScheme: string;
  fontFamily: string;
  warningVar: string;
}

async function rootSnapshot(page: Page): Promise<RootSnapshot> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.app-root')!);
    return {
      bgVar: style.getPropertyValue('--app-bg').trim(),
      bgColor: style.backgroundColor,
      colorScheme: style.getPropertyValue('color-scheme').trim(),
      dataScheme: (document.querySelector('.app-root') as HTMLElement).dataset.scheme ?? '',
      fontFamily: style.fontFamily,
      warningVar: style.getPropertyValue('--desk-warning').trim(),
    };
  });
}

test('тёмная тема из настроек красит экран недавних при запуске (подъём оформления в App)', async () => {
  const session = await launchWithSettings({
    themeId: 'gruvbox-dark',
    fontFamily: 'Lora',
  });
  const { page } = session;
  try {
    // Первый экран без открытой книги: контейнер уже несёт тему.
    await expect(page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
    const root = await rootSnapshot(page);
    expect(root.bgVar).toBe('#1d2021');
    expect(root.bgColor).toBe(themeTokenRgb('gruvbox-dark', '--app-bg'));
    expect(root.colorScheme).toBe('dark');
    expect(root.dataScheme).toBe('dark');
    expect(root.fontFamily).toContain('Geist');
    // Локальный warning-токен переключён на тёмный вариант пары.
    expect(root.warningVar).toBe('#d9a34a');
    // Экран недавних — внутри тематического контейнера (наследование переменных).
    const hintColorVar = await page.evaluate(
      () => getComputedStyle(document.querySelector('.app')!).getPropertyValue('--app-bg').trim(),
    );
    expect(hintColorVar).toBe('#1d2021');
  } finally {
    await session.app.close();
  }
});

test('«Системная» следует за живой сменой схемы ОС без перезапуска', async () => {
  const session = await launchWithSettings({ themeId: 'auto' });
  const { page } = session;
  try {
    await expect(page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await rootSnapshot(page)).dataScheme).toBe('light');
    await expect.poll(async () => (await rootSnapshot(page)).bgVar).toBe('#f6f4ef');

    // Живая смена схемы ОС: контейнер и переменные меняются на лету.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await rootSnapshot(page)).dataScheme).toBe('dark');
    await expect.poll(async () => (await rootSnapshot(page)).bgVar).toBe('#171a19');
    await expect.poll(async () => (await rootSnapshot(page)).colorScheme).toBe('dark');

    // И обратно.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await rootSnapshot(page)).dataScheme).toBe('light');
    await expect.poll(async () => (await rootSnapshot(page)).bgVar).toBe('#f6f4ef');
  } finally {
    await session.app.close();
  }
});

test('ошибки следуют теме: «папка не найдена» красится токеном тёмной темы', async () => {
  const session = await launchWithSettings({ themeId: 'gruvbox-dark' });
  const { page, bookRoot } = session;
  try {
    // Книга попадает в недавние после открытия; окно книги остаётся тематическим.
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.getByRole('button', { name: 'Глава первая', exact: true })).toBeVisible();
    const bookBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('.book')!).getPropertyValue('--app-bg').trim(),
    );
    expect(bookBg).toBe('#1d2021');

    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
  } finally {
    await session.app.close();
  }

  // Папка книги исчезла: экран недавних показывает ошибку themed-токеном.
  await rm(bookRoot, { recursive: true, force: true });
  const relaunch = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: session.userData },
  });
  const page2 = await relaunch.firstWindow();
  try {
    await expect(page2.getByText('папка не найдена')).toBeVisible();
    const missingColor = await page2.evaluate(
      () => getComputedStyle(document.querySelector('.recent-list__missing')!).color,
    );
    expect(missingColor).toBe(themeTokenRgb('gruvbox-dark', '--app-error-text'));
  } finally {
    await relaunch.close();
  }
});


test('явная тёмная тема передаёт текст, каретку и Markdown-палитру редактору при светлой ОС', async () => {
  const session = await launchWithSettings({ themeId: 'gruvbox-dark' });
  try {
    const { page } = session;
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    const content = page.locator('.cm-content');
    await expect(content).toBeVisible();
    await expect(content).toHaveCSS('color', themeTokenRgb('gruvbox-dark', '--ge-color-text'));
    // drawSelection hides the native caret; verify the visible CM cursor.
    await content.click();
    await expect(page.locator('.cm-cursor').first()).toHaveCSS('border-left-color', themeTokenRgb('gruvbox-dark', '--ge-color-text'));
    const tokenNames = ['--ge-color-link', '--ge-color-code-fg', '--ge-color-token-keyword', '--ge-color-token-string', '--ge-color-selection'];
    const actual = await content.evaluate((element, names) => names.map(name => getComputedStyle(element).getPropertyValue(name).trim()), tokenNames);
    const expected = themeToCssVariables(getTheme('gruvbox-dark'));
    expect(actual).toEqual(tokenNames.map(name => expected[name]));
    await expect(page.locator('.review-editor > [data-theme]')).toHaveAttribute('data-theme', 'dark');
  } finally { await session.app.close(); }
});
