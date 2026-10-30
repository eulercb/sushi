import { expect, test, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#primary').tap();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('phone touch controls launch the next plate and keep lane buttons stable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await start(page);
  await expectNoOverflow(page);
  const lane = page.locator('[data-lane="0"]');
  const node = await lane.elementHandle();
  const second = await lane.locator('.piece').nth(1).innerHTML();
  await lane.tap();
  await expect(page.locator('.plate')).toHaveCount(1);
  await expect.poll(() => lane.locator('.piece').first().innerHTML()).toBe(second);
  await expect.poll(() => page.locator('#time').textContent()).not.toBe('1:30');
  expect(await lane.evaluate((element, original) => element === original, node)).toBe(true);
  expect(errors).toEqual([]);
});

test('pause freezes the conveyor and timer; keyboard resumes and launches', async ({ page }) => {
  await start(page);
  await page.keyboard.press('1');
  await expect(page.locator('.plate')).toHaveCount(1);
  await expect.poll(() => page.locator('#time').textContent()).not.toBe('1:30');
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog')).toBeVisible();
  const time = await page.locator('#time').textContent();
  const positions = await page.locator('.plate').evaluateAll(elements => elements.map(element => element.getAttribute('style')));
  await page.clock.install();
  await page.clock.runFor(2200);
  expect(await page.locator('#time').textContent()).toBe(time);
  expect(await page.locator('.plate').evaluateAll(elements => elements.map(element => element.getAttribute('style')))).toEqual(positions);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.clock.runFor(1200);
  await expect(page.locator('#time')).not.toHaveText(time!);
  const lane = page.locator('[data-lane="4"]');
  const nextPiece = await lane.locator('.piece').nth(1).innerHTML();
  const existingPlates = await page.locator('#plates').evaluateHandle(container => Array.from(container.children));
  await page.keyboard.press('5');
  await expect.poll(() => lane.locator('.piece').first().innerHTML()).toBe(nextPiece);
  // Earlier plates can be eaten while time advances; check the new launch itself.
  await expect.poll(() => page.locator('.plate').evaluateAll(
    (elements, previous) => elements.some(element => !previous.includes(element)), existingPlates,
  )).toBe(true);
  await existingPlates.dispose();
});

test('help explains controls and a fresh shift resets play', async ({ page }) => {
  await page.goto('./');
  await page.locator('#intro-help').tap();
  await expect(page.getByRole('dialog')).toContainText('Keys 1–5');
  await page.locator('#primary').tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#primary').tap();
  await page.locator('[data-lane="2"]').tap();
  await expect(page.locator('.plate')).toHaveCount(1);
  await page.locator('#pause').tap();
  await page.locator('#paused-help').tap();
  await expect(page.getByRole('dialog')).toContainText('Tap a lane');
  await page.locator('#primary').tap();
  await expect(page.getByRole('dialog')).toContainText('On a tea break.');
  await page.locator('#restart').tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.plate')).toHaveCount(0);
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#time')).toHaveText('1:30');
});

test('small phone keeps the intro and game within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  await expectNoOverflow(page);
  await expect(page.locator('#primary')).toBeInViewport();
  await page.locator('#primary').tap();
  await expectNoOverflow(page);
  for (const lane of await page.locator('.lane').all()) await expect(lane).toBeInViewport();
});

test('installed service worker caches the app and playable offline reload', async ({ page, context }) => {
  await page.goto('./');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const response = await page.request.get(new URL(manifest!, page.url()).href);
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512' }),
  ]));
  for (const icon of data.icons) {
    const iconResponse = await page.request.get(new URL(icon.src, response.url()).href);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()['content-type']).toMatch(/^image\//);
  }
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#primary').tap();
  await page.locator('[data-lane="0"]').tap();
  await expect(page.locator('.plate')).toHaveCount(1);
});

test('supported install prompt is offered and consumed without crowding a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  await expect(page.locator('#install')).toBeHidden();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.installPrompted = 'yes'; },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });
  await expect(page.locator('#install')).toBeVisible();
  await expectNoOverflow(page);
  await page.locator('#primary').tap();
  await page.locator('#install').tap();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompted', 'yes');
  await expect(page.locator('#install')).toBeHidden();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    window.dispatchEvent(event);
  });
  await expect(page.locator('#install')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#install')).toBeHidden();
});
