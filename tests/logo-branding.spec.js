import { test, expect } from '@playwright/test';

// Every test boots from a clean, first-run desktop (terminal auto-opens).
test.beforeEach(async ({ request }) => {
  await request.post('/api.php?action=reset');
});

// Boot logic is inline and runs on DOMContentLoaded; avoid waiting on slow CDN
// 'load' events (fonts/tailwind) in headless runs.
const goto = (page, url = '/') => page.goto(url, { waitUntil: 'domcontentloaded' });

test.describe('Web Linux OS - Branding & Logo', () => {

  test('page loads successfully with correct title', async ({ page }) => {
    await goto(page);
    await expect(page).toHaveTitle(/Desktopy OS/);
  });

  test('logo image is displayed in the status bar', async ({ page }) => {
    await goto(page);

    const logo = page.locator('img[alt="Logo"]');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', 'logo.png');
  });

  test('status bar contains all expected UI elements', async ({ page }) => {
    await goto(page);

    await expect(page.locator('.glass-panel').first()).toBeVisible();
    await expect(page.locator('#top-time')).toBeVisible();
    await expect(page.locator('#top-date')).toBeVisible();
  });

  test('desktop widgets render correctly', async ({ page }) => {
    await goto(page);

    const widgets = page.locator('.desktop-widget');
    await expect(widgets).toHaveCount(2);
    await expect(widgets.first()).toContainText('Kernel Health');
  });

  test('app launcher can be opened and renders app grid', async ({ page }) => {
    await goto(page);

    await page.click('text=الأنشطة');
    await expect(page.locator('#launcher-overlay')).toHaveClass(/active/);

    const grid = page.locator('#launcher-grid');
    await expect(grid).toBeVisible();
  });

  test('logo file is valid PNG served correctly', async ({ page }) => {
    const response = await page.goto('/logo.png');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toBe('image/png');
  });

  test('terminal app can be opened', async ({ page }) => {
    await goto(page);

    const term = page.locator('.font-mono');
    await expect(term).toContainText('Desktopy OS');
  });
});
