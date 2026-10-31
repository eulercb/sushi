import { expect, test, type Page } from '@playwright/test';

async function start(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
  await page.goto('./');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#primary').tap();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
const queues = (page: Page) => page.locator('.lane-pieces').evaluateAll(nodes => nodes.map(node => node.innerHTML));
async function hold(page: Page, lane = 0) {
  const box = await page.locator(`[data-lane="${lane}"]`).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
}

test('tap advances the queue, preserves controls, and fixed belt slots never overlap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await start(page);
  await expectNoOverflow(page);
  const initialOrders = await page.locator('.guest').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-remaining'))));
  expect(initialOrders).toHaveLength(4);
  for (const quantity of initialOrders) {
    expect(quantity).toBeGreaterThanOrEqual(4);
    expect(quantity).toBeLessThanOrEqual(7);
  }
  const lane = page.locator('[data-lane="0"]');
  const node = await lane.elementHandle();
  const second = await lane.locator('.piece').nth(1).innerHTML();
  await lane.tap();
  await expect(page.locator('.plate')).toHaveCount(1);
  await expect.poll(() => lane.locator('.piece').first().innerHTML()).toBe(second);
  expect(await lane.evaluate((element, original) => element === original, node)).toBe(true);
  await hold(page, 1);
  await page.clock.runFor(2500);
  await page.mouse.up();
  await expect(page.locator('.slot')).toHaveCount(18);
  const geometry = await page.locator('.plate').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }));
  expect(geometry.length).toBeGreaterThan(1);
  for (let i = 0; i < geometry.length; i++) for (let j = i + 1; j < geometry.length; j++) {
    expect(Math.hypot(geometry[i].x - geometry[j].x, geometry[i].y - geometry[j].y)).toBeGreaterThan(24);
  }
  expect(errors).toEqual([]);
});

test('eight distinct sushi previews retain five usable lanes and launch their named food', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await expect(page.locator('.lane')).toHaveCount(5);
  const catalog = ['salmon', 'tuna', 'maki', 'shrimp', 'tamago', 'avocado', 'cucumber', 'ikura'];
  const previews = await page.locator('.lane .piece').evaluateAll(nodes => nodes.map(node => ({
    type: node.getAttribute('data-type'),
    artwork: node.querySelector('svg')?.innerHTML || '',
    shapes: node.querySelectorAll('svg path, svg ellipse, svg rect, svg circle').length,
  })));
  expect([...new Set(previews.map(piece => piece.type))].sort()).toEqual([...catalog].sort());
  const artworks = catalog.map(type => previews.find(piece => piece.type === type)!);
  expect(new Set(artworks.map(piece => piece.artwork)).size).toBe(8);
  for (const piece of artworks) {
    expect(piece.artwork).not.toBe('');
    expect(piece.shapes).toBeGreaterThan(2);
  }
  const names: Record<string, string> = { avocado: 'Avocado maki', cucumber: 'Cucumber maki', ikura: 'Ikura gunkan' };
  for (const [type, name] of Object.entries(names)) {
    await page.locator('#pause').tap();
    await page.locator('#restart').tap();
    const laneNumber = await page.locator(`.lane .piece[data-type="${type}"]`).first().evaluate(node => node.closest('.lane')!.getAttribute('data-lane'));
    const lane = page.locator(`[data-lane="${laneNumber}"]`);
    // Advance an actual visible queue until the selected food reaches its launch gate.
    for (let step = 0; step < 8 && await lane.getAttribute('data-type') !== type; step++) {
      await lane.tap();
      await page.clock.runFor(550);
    }
    await expect(lane).toHaveAttribute('data-type', type);
    expect(await lane.getAttribute('aria-label')).toContain(`send ${name}.`);
    await lane.tap();
    await expect(page.locator(`.plate[data-type="${type}"]`)).not.toHaveCount(0);
    await page.clock.runFor(550);
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoOverflow(page);
  for (const lane of await page.locator('.lane').all()) await expect(lane).toBeInViewport();
  expect(errors).toEqual([]);
});

test('holding repeats through free gates; release and pointer cancellation stop launches', async ({ page }) => {
  await start(page);
  await expect(page.locator('.lane').first()).toHaveCSS('touch-action', 'none');
  await hold(page);
  const initial = await queues(page);
  await page.clock.runFor(2500);
  expect(await queues(page)).not.toEqual(initial);
  await page.mouse.up();
  const released = await queues(page);
  await page.clock.runFor(4000);
  expect(await queues(page)).toEqual(released);
  await hold(page, 1);
  await page.locator('[data-lane="1"]').dispatchEvent('pointercancel', { pointerId: 1 });
  const canceled = await queues(page);
  await page.clock.runFor(2500);
  expect(await queues(page)).toEqual(canceled);
  await page.mouse.up();
});

test('a held finger repeats launches and lifting it stops further launches', async ({ page, context }) => {
  await start(page);
  const client = await context.newCDPSession(page);
  const box = await page.locator('[data-lane="0"]').boundingBox();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id: 0 }] });
  const pressed = await queues(page);
  await page.clock.runFor(2500);
  expect(await queues(page)).not.toEqual(pressed);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const released = await queues(page);
  await page.clock.runFor(4000);
  expect(await queues(page)).toEqual(released);
  await client.detach();
});

test('pause freezes every slot and plate, clears holds, and supports keyboard play', async ({ page }) => {
  await start(page);
  await page.keyboard.down('1');
  await page.clock.runFor(1400);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog')).toContainText('On a tea break.');
  const positions = await page.locator('.plate, .slot').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')));
  await page.clock.runFor(3000);
  expect(await page.locator('.plate, .slot').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')))).toEqual(positions);
  await page.keyboard.up('1');
  await page.keyboard.press('p');
  const released = await queues(page);
  await page.clock.runFor(1500);
  expect(await queues(page)).toEqual(released);
  await page.keyboard.press('5');
  expect(await queues(page)).not.toEqual(released);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
});

for (const reason of ['visibility', 'blur'] as const) {
  test(`${reason} pauses and clears a held lane`, async ({ page }) => {
    await start(page);
    await hold(page);
    await page.evaluate(reason => {
      if (reason === 'visibility') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      } else window.dispatchEvent(new Event('blur'));
    }, reason);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.up();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
    await page.locator('#primary').tap();
    const stopped = await queues(page);
    await page.clock.runFor(2500);
    expect(await queues(page)).toEqual(stopped);
  });
}

test('help describes unhurried play and a fresh run clears the belt', async ({ page }) => {
  await page.goto('./');
  await page.locator('#modal-help').tap();
  await expect(page.getByRole('dialog')).toContainText('guests will wait');
  await expect(page.getByRole('dialog')).toContainText('Hold keys 1–5');
  await page.locator('#primary').tap();
  await page.locator('#primary').tap();
  await page.locator('[data-lane="2"]').tap();
  await page.locator('#pause').tap();
  await page.locator('#restart').tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.plate')).toHaveCount(0);
  await expect(page.locator('#served')).toHaveText('0');
});

test('real completed orders appear in local rankings after reload', async ({ page }) => {
  test.setTimeout(60000);
  await start(page);
  for (let step = 0; step < 100 && await page.locator('#served').textContent() === '0'; step++) {
    const needs = await page.locator('.guest').evaluateAll(nodes => nodes.reduce<Record<string, number>>((counts, node) => {
      const type = node.getAttribute('data-type');
      if (type) counts[type] = (counts[type] || 0) + Number(node.getAttribute('data-remaining'));
      return counts;
    }, {}));
    const traveling = await page.locator('.plate').evaluateAll(nodes => nodes.reduce<Record<string, number>>((counts, node) => {
      const type = node.getAttribute('data-type')!;
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {}));
    const fronts = await page.locator('.lane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type') || ''));
    const lane = fronts.findIndex(front => Object.entries(needs).some(([type, quantity]) => quantity > (traveling[type] || 0) && front === type));
    // Wait for plates already traveling before clearing another queue front.
    const allNeededTraveling = Object.entries(needs).every(([type, quantity]) => quantity <= (traveling[type] || 0));
    if (lane >= 0 || !allNeededTraveling) await page.keyboard.press(String((lane >= 0 ? lane : step % 5) + 1));
    await page.clock.runFor(550);
  }
  const served = Number(await page.locator('#served').textContent());
  expect(served).toBeGreaterThan(0);
  await page.locator('#ranking').tap();
  await expect(page.locator('.ranking-list li').first()).toContainText(`${served} ${served === 1 ? 'guest' : 'guests'}`);
  await page.reload();
  await page.locator('#modal-ranking').tap();
  await expect(page.locator('.ranking-list li').first()).toContainText(`${served} ${served === 1 ? 'guest' : 'guests'}`);
});

test('a full eighteen-slot belt ends the run through ordinary lane input', async ({ page }) => {
  test.setTimeout(60000);
  await start(page);
  for (let step = 0; step < 160 && !(await page.getByRole('dialog').isVisible()); step++) {
    const requests = await page.locator('.guest').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
    const fronts = await page.locator('.lane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type') || ''));
    const lane = fronts.findIndex(front => !requests.includes(front));
    await page.keyboard.press(String((lane < 0 ? 0 : lane) + 1));
    await page.clock.runFor(550);
  }
  await expect(page.getByRole('dialog')).toContainText('A full belt');
  await expect(page.locator('#capacity')).toHaveText('18 / 18');
  await expect(page.locator('.plate')).toHaveCount(18);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const plates = await page.locator('.plate').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
    }));
    for (let i = 0; i < plates.length; i++) for (let j = i + 1; j < plates.length; j++) {
      const dx = (plates[i].x - plates[j].x) / ((plates[i].width + plates[j].width) / 2);
      const dy = (plates[i].y - plates[j].y) / ((plates[i].height + plates[j].height) / 2);
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(1);
    }
  }
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
