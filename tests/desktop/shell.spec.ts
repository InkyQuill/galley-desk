import { test, expect, _electron as electron } from '@playwright/test';
test('launches without node access in renderer', async () => {
  const app = await electron.launch({args:['apps/desktop']});
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Galley Desk'})).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
  } finally { await app.close(); }
});

test('blocks navigation away from the app origin', async () => {
  const app = await electron.launch({args:['apps/desktop']});
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Galley Desk'})).toBeVisible();
    // Строка начинается с `http://localhost:5173` (префиксная проверка пропустила бы),
    // но origin URL — http://127.0.0.1:1.
    await page.evaluate(() => { window.location.href = 'http://localhost:5173@127.0.0.1:1/'; });
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('127.0.0.1');
    expect(page.url()).toContain('index.html');
  } finally { await app.close(); }
});
