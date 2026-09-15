import { test, expect, _electron as electron } from '@playwright/test';
test('launches without node access in renderer', async () => {
  const app = await electron.launch({args:['apps/desktop']});
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Galley Desk'})).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  } finally { await app.close(); }
});
