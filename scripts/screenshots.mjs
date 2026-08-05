/**
 * Capture the Desktopy OS screenshots used in README.md / docs.
 *
 *   npm run screenshots
 *
 * Spawns its own server (node serve.mjs -> PHP backend) on port 3987,
 * drives the UI headlessly, and writes PNGs into docs/screenshots/.
 * Resets persisted state before and after so the repo stays clean.
 */
import { chromium } from '@playwright/test';
import http from 'http';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(outDir, { recursive: true });

const mimes = { html: 'text/html', png: 'image/png', svg: 'image/svg+xml', css: 'text/css', js: 'application/javascript', ico: 'image/x-icon', json: 'application/json', txt: 'text/plain' };
const publicDir = path.join(root, 'public');

const app = http.createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const fp = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
  if (path.extname(fp) === '.php') {
    const parsed = new URL(req.url, BASE);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const r = spawnSync('php', [fp, JSON.stringify({ method: req.method, query: parsed.search.slice(1), body: Buffer.concat(chunks).toString('utf8') })], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) { res.writeHead(500); res.end(r.stderr || 'php failed'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(r.stdout);
    });
    return;
  }
  try {
    const c = fs.readFileSync(fp);
    res.writeHead(200, { 'Content-Type': mimes[path.extname(fp).slice(1)] || 'application/octet-stream' });
    res.end(c);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve) => app.listen(PORT, resolve));
console.log(`Screenshot server on ${BASE}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(action, method = 'GET', body = null) {
  const url = `${BASE}/api.php?action=${action}`;
  const res = await page.request.fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    data: body,
  });
  return res.json();
}

async function shot(name) {
  await sleep(650); // let animations settle
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('captured', name);
}

async function boot() {
  await api('reset', 'POST');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__desktopyBooted === true, null, { timeout: 15000 });
  await page.waitForSelector('#win-terminal');
  await sleep(800);
}

async function setWin(id, x, y, w, h) {
  await page.evaluate(({ id, x, y, w, h }) => {
    const el = document.getElementById(`win-${id}`);
    if (!el) return;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    const entry = window.__desktopy.state.windows[id];
    if (entry) entry.rect = { x, y, w, h };
  }, { id, x, y, w, h });
}

async function seedExtraFiles() {
  await api('write', 'POST', { path: 'home/Documents/api-spec.md', content: '# API\n\n- `GET api.php?action=ls`\n- `POST api.php?action=write`\n- `POST api.php?action=state`\n' });
  await api('write', 'POST', { path: 'home/Notes/todo.txt', content: 'Screenshots ✓\nPHP backend ✓\nPersistence ✓\nREADME ✓\n' });
}

try {
  /* 1 — welcome desktop (fresh boot, terminal) */
  await boot();
  await shot('01-welcome-desktop.png');

  /* 2 — app launcher with search */
  await page.click('text=الأنشطة');
  await page.fill('#launcher-search', 'co');
  await sleep(700);
  await shot('02-app-launcher.png');
  await page.keyboard.press('Escape');
  await sleep(400);

  /* 3 — multi-window workspace */
  await seedExtraFiles();
  await page.evaluate(() => window.__desktopy.openApp('files'));
  await page.evaluate(() => window.__desktopy.openApp('editor'));
  await page.evaluate(() => window.__desktopy.openApp('monitor'));
  await page.evaluate(() => window.__desktopy.openApp('calc'));
  await page.waitForSelector('#win-files');
  await page.waitForSelector('#win-monitor');
  await sleep(1200);
  await setWin('terminal', 40, 70, 620, 430);
  await setWin('files', 680, 55, 880, 540);
  await setWin('editor', 55, 520, 600, 440);
  await setWin('monitor', 700, 610, 470, 350);
  await setWin('calc', 1155, 300, 380, 560);
  await page.evaluate(() => window.__desktopy.state.windows.files && (window.__desktopy.state.windows.files.element.style.zIndex = 500));
  await sleep(1000);
  await shot('03-workspace.png');

  /* 4 — files explorer focused */
  await page.evaluate(() => window.__desktopy.openApp('files'));
  await page.evaluate(() => window.__desktopy.closeApp('monitor'));
  await page.evaluate(() => window.__desktopy.closeApp('calc'));
  await setWin('files', 130, 60, 1340, 640);
  await setWin('editor', 60, 520, 560, 420);
  await setWin('terminal', 700, 560, 600, 380);
  await sleep(1200);
  await shot('04-files-explorer.png');

  /* 5 — terminal with real PHP commands */
  await page.evaluate(() => window.__desktopy.closeApp('files'));
  await page.evaluate(() => window.__desktopy.closeApp('editor'));
  await setWin('terminal', 300, 120, 1000, 620);
  const input = page.locator('#term-in-terminal');
  await input.fill('neofetch');
  await input.press('Enter');
  await input.fill('ls');
  await input.press('Enter');
  await input.fill('tree');
  await input.press('Enter');
  await sleep(1500);
  await shot('05-terminal-commands.png');

  /* 6 — light theme, English UI */
  await page.evaluate(() => window.__desktopy.toggleLang('en'));
  await page.evaluate(() => window.__desktopy.toggleTheme('light'));
  await page.evaluate(() => window.__desktopy.setAccent('emerald'));
  await page.evaluate(() => window.__desktopy.openApp('settings'));
  await page.waitForSelector('#win-settings');
  await setWin('settings', 420, 140, 760, 560);
  await setWin('terminal', 60, 160, 600, 500);
  await sleep(1200);
  await shot('06-light-theme.png');

  console.log('All screenshots captured.');
} catch (err) {
  console.error('Screenshot run failed:', err.message);
  process.exitCode = 1;
} finally {
  await api('reset', 'POST').catch(() => { });
  await browser.close();
  app.close();
  console.log('State reset, server stopped.');
}
