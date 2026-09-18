// Electron-тесты общей тем-подсказки (история №7 UX-ревью, Task 10): hover с
// задержкой, фокус сразу, role=tooltip + aria-describedby, Escape и потеря
// фокуса скрывают её не мешая остальным обработчикам, тема/UI-шрифт
// наследуются из настроек оформления, disabled-триггер не получает лишний
// tab stop, подсказка у края экрана не выходит за viewport. Запуск -- по
// собранному Forge-входу (.vite/build): сначала `npm run package`.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

async function launchWithBook(files: Record<string, string>): Promise<Session & { openByDialog: () => Promise<void> }> {
  const bookRoot = await makeTempDir('galley-e2e-tooltip-book-');
  const userData = await makeTempDir('galley-e2e-tooltip-user-');
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.bringToFront();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  const openByDialog = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
  };
  return { app, page, userData, bookRoot, openByDialog };
}

/** Отдельная тема оформления в settings.json -- как в theming.spec.ts. */
async function launchWithAppearance(appearance: Record<string, unknown>): Promise<Session> {
  const bookRoot = await makeTempDir('galley-e2e-tooltip-theme-book-');
  const userData = await makeTempDir('galley-e2e-tooltip-theme-user-');
  await writeFile(path.join(bookRoot, 'Глава.md'), '# Глава\n\nкот спит на подоконнике.\n', 'utf8');
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

async function relaunch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page };
}

/** Прямоугольник и id host'а подсказки -- один на всё приложение (#gd-tooltip). */
async function tooltipBox(page: Page) {
  return page.getByRole('tooltip').boundingBox();
}

test('наведение показывает подсказку с задержкой (role=tooltip, aria-describedby); mouseleave скрывает; native title отсутствует', async () => {
  const session = await launchWithBook({});
  const { app, page } = session;
  try {
    // Дожидаемся, пока экран недавних осядет (recents подгружаются
    // асинхронно) -- иначе ремонт TitleBar под курсором может снять
    // отложенный таймер показа раньше 300 мс, до окончания hover-задержки.
    await expect(page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
    await page.waitForTimeout(300);
    const button = page.locator('.titlebar__diagnostics');
    await expect(button).toBeVisible();
    // Нативного title у мигрированной кнопки быть не должно -- только Tooltip.
    expect(await button.getAttribute('title')).toBeNull();

    const started = Date.now();
    await button.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    // Наведение показывает не мгновенно -- задержка ~300 мс (допуск на дрожание).
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    await expect(tooltip).toHaveText('Диагностика');

    const tooltipId = await tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();
    expect(await button.getAttribute('aria-describedby')).toBe(tooltipId);

    await page.mouse.move(2, 2);
    await expect(tooltip).toHaveCount(0);
    // aria-describedby не остаётся висеть на скрытой подсказке.
    expect(await button.getAttribute('aria-describedby')).toBeNull();
  } finally {
    await app.close();
  }
});

test('Zen: фокус показывает подсказку сразу с отдельной строкой shortcut; Escape скрывает и не переключает Zen/не мешает остальным обработчикам', async () => {
  const session = await launchWithBook({ 'Глава.md': '# Глава\n\nкот спит.\n' });
  const { app, page, openByDialog } = session;
  try {
    await openByDialog();
    const zenButton = page.getByRole('button', { name: 'Режим Zen', exact: true });
    await zenButton.focus();
    const tooltip = page.getByRole('tooltip');
    // Фокус показывает без задержки наведения -- в отличие от hover-теста выше.
    await expect(tooltip).toBeVisible({ timeout: 500 });
    await expect(tooltip).toContainText('Alt');
    await expect(page.locator('.gd-tooltip__shortcut')).toContainText(process.platform === 'darwin' ? 'Cmd' : 'Ctrl');

    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    // Верхний Escape-обработчик BookWindow не задет и не сработал по Zen.
    await expect(page.locator('.book--zen')).toHaveCount(0);
    await expect(page.locator('.titlebar')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('переключение общей подсказки снимает aria-describedby с предыдущего trigger', async () => {
  const session = await launchWithBook({});
  const { app, page } = session;
  try {
    await expect(page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
    const previous = page.getByRole('button', { name: 'Свернуть окно' });
    const next = page.locator('.titlebar__diagnostics');
    await previous.focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    const tooltipId = await tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();
    await expect(previous).toHaveAttribute('aria-describedby', tooltipId!);

    await next.hover();
    await expect(tooltip).toHaveText('Диагностика');
    await expect(previous).not.toHaveAttribute('aria-describedby', /gd-tooltip/);
    await expect(next).toHaveAttribute('aria-describedby', tooltipId!);
  } finally {
    await app.close();
  }
});

test('подсказка наследует тему оформления и UI-шрифт настроек, а не фиксированный CSS', async () => {
  const session = await launchWithAppearance({ themeId: 'gruvbox-dark', uiFontFamily: 'Verdana' });
  const { app, page } = session;
  try {
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();

    await page.getByRole('button', { name: 'Меню книги' }).focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible({ timeout: 500 });

    const style = await tooltip.evaluate((node) => {
      const computed = getComputedStyle(node);
      return { background: computed.backgroundColor, fontFamily: computed.fontFamily };
    });
    expect(style.fontFamily).toContain('Verdana');
    const panelVar = themeToCssVariables(getTheme('gruvbox-dark'))['--app-panel'] as string;
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(panelVar.trim())!;
    const expectedRgb = `rgb(${Number.parseInt(hex[1]!, 16)}, ${Number.parseInt(hex[2]!, 16)}, ${Number.parseInt(hex[3]!, 16)})`;
    expect(style.background).toBe(expectedRgb);
  } finally {
    await app.close();
  }
});

test('глава без файла: disabled-кнопка не получает лишний tab stop, но подсказка всё равно доступна по aria-describedby', async () => {
  const bookRoot = await makeTempDir('galley-e2e-tooltip-missing-book-');
  const userData = await makeTempDir('galley-e2e-tooltip-missing-user-');
  await writeFile(path.join(bookRoot, 'Глава 1.md'), '# Первая\n\nкот\n', 'utf8');
  await writeFile(path.join(bookRoot, 'Глава 2.md'), '# Вторая\n\nпёс\n', 'utf8');
  const app0 = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: userData } });
  const page0 = await app0.firstWindow();
  await page0.setViewportSize({ width: 1280, height: 900 });
  await app0.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  await page0.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(page0.locator('.cm-content')).toBeVisible();
  await app0.close();
  await rm(path.join(bookRoot, 'Глава 2.md'));

  const { app, page } = await relaunch(userData);
  try {
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();

    const missingButton = page.locator('.book__chapters button:disabled');
    await expect(missingButton).toHaveCount(1);
    // Tooltip не оборачивает disabled-кнопку в фокусируемый span/div -- ни
    // один элемент панели глав не получил ручного tabindex.
    expect(await page.locator('.book__chapters [tabindex]').count()).toBe(0);
    expect(await missingButton.getAttribute('title')).toBeNull();

    // disabled-кнопка нативно не может получить фокус -- подсказка проверяется
    // наведением (Chromium доставляет mouseenter/mouseleave и на disabled).
    await missingButton.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await expect(tooltip).toHaveText('Файл главы отсутствует');
  } finally {
    await app.close();
  }
});

test('подсказка у края окна остаётся в пределах viewport (отступ 8px)', async () => {
  const session = await launchWithBook({ 'Глава.md': '# Глава\n\nкот\n' });
  const { app, page, openByDialog } = session;
  try {
    await openByDialog();
    // Узкое окно прижимает крайнюю правую кнопку топбара к границе viewport.
    await page.setViewportSize({ width: 480, height: 700 });
    const menuButton = page.getByRole('button', { name: 'Меню книги' });
    await menuButton.hover();
    await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 1000 });
    const box = await tooltipBox(page);
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(480 - 8 + 0.5);
  } finally {
    await app.close();
  }
});
