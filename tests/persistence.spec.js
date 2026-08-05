import { test, expect } from '@playwright/test';

// Fresh boot for every test (deletes the persisted state file).
test.beforeEach(async ({ request }) => {
  await request.post('/api.php?action=reset');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Boot logic is inline and DOM-ready immediately; avoid waiting on slow CDN
// 'load' events (fonts/tailwind) in headless runs.
const goto = (page, url = '/') => page.goto(url, { waitUntil: 'domcontentloaded' });
const reload = (page) => page.reload({ waitUntil: 'domcontentloaded' });

// Resolves once the OS boot sequence (backend ping + state restore) finished.
const booted = (page) => page.waitForFunction(() => window.__desktopyBooted === true, null, { timeout: 15000 });

test.describe('PHP persistence - windows & preferences', () => {

  test('theme choice persists across reloads', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);

    await page.evaluate(() => window.__desktopy.toggleTheme('light'));
    await sleep(900); // debounced save
    await reload(page);
    await booted(page);

    await page.waitForFunction(() => document.body.classList.contains('light'), null, { timeout: 10000 });
  });

  test('window position survives a reload (drag -> PHP -> restore)', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);

    await page.evaluate(() => window.__desktopy.openApp('calc'));
    await page.waitForSelector('#win-calc');

    const header = page.locator('#win-calc .window-header');
    const box = await header.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 90, { steps: 8 });
    await page.mouse.up();
    await sleep(1000);

    const before = await page.evaluate(() => {
      const el = document.getElementById('win-calc');
      return { left: el.style.left, top: el.style.top };
    });

    await reload(page);
    await booted(page);
    await page.waitForSelector('#win-calc');

    const after = await page.evaluate(() => {
      const el = document.getElementById('win-calc');
      return { left: el.style.left, top: el.style.top };
    });
    // The backend persists integer positions (Math.round), so compare rounded.
    expect(Math.round(parseFloat(after.left))).toBe(Math.round(parseFloat(before.left)));
    expect(Math.round(parseFloat(after.top))).toBe(Math.round(parseFloat(before.top)));
  });

  test('minimized window state persists across reloads', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);

    await page.evaluate(() => window.__desktopy.openApp('calc'));
    await page.waitForSelector('#win-calc');
    await page.evaluate(() => {
      document.querySelector('#win-calc .window-header .traffic:nth-child(2)').click();
    });
    await sleep(1000);

    await reload(page);
    await booted(page);
    await page.waitForSelector('#win-calc');
    const minimized = await page.evaluate(() =>
      document.getElementById('win-calc').classList.contains('minimized')
    );
    expect(minimized).toBe(true);
  });

  test('closing every window persists an empty desktop', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);

    await page.evaluate(() => {
      document.querySelector('#win-terminal .btn-close').click();
    });
    await sleep(1500);

    await reload(page);
    await booted(page);
    expect(await page.locator('.os-window').count()).toBe(0);
  });

  test('language preference persists across reloads', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);

    await page.evaluate(() => window.__desktopy.toggleLang('en'));
    await sleep(900);
    await reload(page);
    await booted(page);

    await page.waitForFunction(() => document.documentElement.dir === 'ltr', null, { timeout: 10000 });
  });
});

test.describe('PHP backend - file system API', () => {

  test('mkdir / write / ls / read / rm round-trip', async ({ request }) => {
    const mk = await request.post('/api.php?action=mkdir', { data: { path: 'home/tests' } });
    expect((await mk.json()).ok).toBe(true);

    const wr = await request.post('/api.php?action=write', {
      data: { path: 'home/tests/demo.txt', content: 'hello persistence' },
    });
    expect((await wr.json()).ok).toBe(true);

    const ls = await request.get('/api.php?action=ls&path=home/tests');
    const lsBody = await ls.json();
    expect(lsBody.ok).toBe(true);
    expect(lsBody.entries.some((e) => e.name === 'demo.txt')).toBe(true);

    const rd = await request.get('/api.php?action=read&path=home/tests/demo.txt');
    expect((await rd.json()).content).toBe('hello persistence');

    const rm1 = await request.post('/api.php?action=rm', { data: { path: 'home/tests/demo.txt' } });
    expect((await rm1.json()).ok).toBe(true);
    const rm2 = await request.post('/api.php?action=rm', { data: { path: 'home/tests' } });
    expect((await rm2.json()).ok).toBe(true);
  });

  test('path traversal outside the sandbox is rejected', async ({ request }) => {
    const ls = await request.get('/api.php?action=ls&path=../..');
    const body = await ls.json();
    expect(body.ok).toBe(false);
  });

  test('terminal filesystem commands hit the PHP backend', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);
    const input = page.locator('#term-in-terminal');
    const out = page.locator('#term-out-terminal');

    await input.fill('mkdir demo');
    await input.press('Enter');
    await input.fill('write demo/test.txt hello-php');
    await input.press('Enter');
    await input.fill('cat demo/test.txt');
    await input.press('Enter');

    await expect(out).toContainText('written home/demo/test.txt', { timeout: 15000 });
    await expect(out).toContainText('hello-php', { timeout: 15000 });

    // Clean up
    await input.fill('rm demo/test.txt');
    await input.press('Enter');
    await input.fill('rm demo');
    await input.press('Enter');
    await sleep(800);
  });

  test('reset restores a fresh first-run desktop', async ({ page }) => {
    await goto(page);
    await page.waitForSelector('#win-terminal');
    await booted(page);

    await page.evaluate(() => window.__desktopy.openApp('calc'));
    await page.waitForSelector('#win-calc');
    await sleep(900);

    // Programmatic reset (suppresses the beforeunload save) then reloads.
    await page.evaluate(() => window.__desktopy.resetDesktop()).catch(() => { });
    await booted(page);
    await page.waitForSelector('#win-terminal');

    // Fresh boot -> only the default terminal window opens.
    expect(await page.locator('.os-window').count()).toBe(1);
  });
});
