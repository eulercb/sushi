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

test('animation frames stop while ready and paused, and restart on resume', async ({ page }) => {
  // Use real timers: Playwright's virtual clock replaces the RAF wrapper itself.
  await page.addInitScript(() => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    let requests = 0;
    Object.defineProperty(window, '__testFrameRequests', { get: () => requests });
    window.requestAnimationFrame = callback => {
      requests++;
      return nativeFrame(callback);
    };
  });
  const frames = () => page.evaluate(() => Number(Reflect.get(window, '__testFrameRequests')));
  await page.goto('./');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(500);
  const ready = await frames();
  await page.waitForTimeout(500);
  expect(await frames()).toBe(ready);
  await page.locator('#primary').tap();
  await expect.poll(frames).toBeGreaterThan(ready);
  await page.locator('#pause').tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(500);
  const paused = await frames();
  await page.waitForTimeout(500);
  expect(await frames()).toBe(paused);
  await page.locator('#primary').tap();
  await expect.poll(frames).toBeGreaterThan(paused);
});

test('quiet belt motion updates transforms without cloning state or rewriting the HUD', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeClone = window.structuredClone.bind(window);
    let clones = 0;
    Object.defineProperty(window, '__testStateClones', { get: () => clones });
    window.structuredClone = (...args: Parameters<typeof structuredClone>) => {
      clones++;
      return nativeClone(...args);
    };
  });
  await page.goto('./');
  await page.locator('#primary').tap();
  await page.waitForTimeout(750);
  const before = await page.evaluate(() => {
    document.documentElement.dataset.hudMutations = '0';
    const observer = new MutationObserver(records => {
      document.documentElement.dataset.hudMutations = String(Number(document.documentElement.dataset.hudMutations) + records.length);
    });
    for (const selector of ['.hud', '.guest', '.lane-pieces', '#status']) {
      document.querySelectorAll(selector).forEach(node => observer.observe(node, { subtree: true, childList: true, characterData: true, attributes: true }));
    }
    return {
      clones: Number(Reflect.get(window, '__testStateClones')),
      styles: Array.from(document.querySelectorAll<HTMLElement>('.slot'), node => ({ transform: node.style.transform, left: node.style.left, top: node.style.top })),
    };
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    clones: Number(Reflect.get(window, '__testStateClones')),
    mutations: Number(document.documentElement.dataset.hudMutations),
    styles: Array.from(document.querySelectorAll<HTMLElement>('.slot'), node => ({ transform: node.style.transform, left: node.style.left, top: node.style.top })),
  }));
  expect(Number.isFinite(before.clones)).toBe(true);
  expect(after.clones).toBe(before.clones);
  expect(after.mutations).toBe(0);
  expect(after.styles).toHaveLength(40);
  expect(after.styles.map(slot => slot.transform)).not.toEqual(before.styles.map(slot => slot.transform));
  expect(after.styles.map(({ left, top }) => ({ left, top }))).toEqual(before.styles.map(({ left, top }) => ({ left, top })));
});

test('fractional progress percentages do not rewrite an unchanged occupied HUD', async ({ page }) => {
  await start(page);
  await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
  // Accepted queue inputs keep loading active, without moving plates past guests.
  for (let request = 0; request < 23; request++) await page.keyboard.press('1');
  await page.clock.runFor(4250);
  await expect(page.locator('#capacity')).toHaveText('22 / 40');
  await expect(page.locator('.plate')).toHaveCount(22);
  await expect(page.locator('.launch-gate')).toHaveClass(/loading/);
  await expect.poll(() => page.locator('#progress').evaluate(node => {
    const bar = node.getBoundingClientRect();
    return bar.width / node.parentElement!.getBoundingClientRect().width;
  })).toBeCloseTo(22 / 40, 2);
  await page.evaluate(() => {
    document.documentElement.dataset.occupiedHudMutations = '0';
    new MutationObserver(records => {
      document.documentElement.dataset.occupiedHudMutations = String(Number(document.documentElement.dataset.occupiedHudMutations) + records.length);
    }).observe(document.querySelector('.hud')!, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.clock.runFor(80);
  await expect(page.locator('#capacity')).toHaveText('22 / 40');
  expect(await page.evaluate(() => Number(document.documentElement.dataset.occupiedHudMutations))).toBe(0);
  await page.clock.runFor(100);
  await expect(page.locator('#capacity')).toHaveText('23 / 40');
  await expect(page.locator('.plate')).toHaveCount(23);
  await expect(page.locator('.launch-gate')).not.toHaveClass(/loading/);
  // Allow the observer's insertion-update delivery before measuring quiet motion.
  await page.evaluate(() => { document.documentElement.dataset.occupiedHudMutations = '0'; });
  const occupant = page.locator('.plate').first();
  await expect(occupant).toBeVisible();
  const plate = (await occupant.elementHandle())!;
  const transform = await plate.getAttribute('style');
  expect(transform).toBeTruthy();
  await page.clock.runFor(80);
  await expect(page.locator('#capacity')).toHaveText('23 / 40');
  expect(await plate.evaluate(node => node.isConnected)).toBe(true);
  expect(await plate.getAttribute('style')).not.toBe(transform);
  expect(await page.evaluate(() => Number(document.documentElement.dataset.occupiedHudMutations))).toBe(0);
});
async function expectSeparatedPlates(page: Page) {
  const plates = await page.locator('.plate').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
  }));
  for (const plate of plates) {
    expect(plate.width).toBeGreaterThan(0);
    expect(plate.height).toBeGreaterThan(0);
  }
  for (let i = 0; i < plates.length; i++) for (let j = i + 1; j < plates.length; j++) {
    const dx = (plates[i].x - plates[j].x) / ((plates[i].width + plates[j].width) / 2);
    const dy = (plates[i].y - plates[j].y) / ((plates[i].height + plates[j].height) / 2);
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(1);
  }
}
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
  await expect(page.locator('.slot')).toHaveCount(40);
  expect(await page.locator('.plate').count()).toBeGreaterThan(1);
  await expectSeparatedPlates(page);
  expect(errors).toEqual([]);
});

test('rapid taps reserve exact foods, pause the belt, and load FIFO into separate slots', async ({ page }) => {
  await start(page);
  await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
  const lanes = page.locator('.lane');
  const choices = await lanes.evaluateAll(nodes => nodes.slice(0, 3).map(node => ({
    food: node.getAttribute('data-type'),
    next: node.querySelectorAll('.piece')[1].getAttribute('data-type'),
  })));
  expect(new Set(choices.map(choice => choice.food)).size).toBe(3);
  await lanes.nth(0).tap();
  await expect(page.locator('.plate')).toHaveCount(1);
  const originalSlot = Number(await page.locator('.plate').getAttribute('data-slot'));
  await lanes.nth(1).tap();
  await expect(lanes.nth(0)).toHaveAttribute('data-type', choices[0].next!);
  await expect(lanes.nth(1)).toHaveAttribute('data-type', choices[1].next!);
  await expect(page.locator('.launch-gate')).toHaveClass(/loading/);
  await expect(page.locator('#status')).toContainText('Making room');
  const frozenSlots = await page.locator('.slot').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')));
  await page.clock.runFor(100);
  expect(await page.locator('.slot').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')))).toEqual(frozenSlots);
  await expect(page.locator('.plate')).toHaveCount(1);

  // A third deliberate tap must retain its chosen food while the second is loading.
  await lanes.nth(2).tap();
  await expect(lanes.nth(2)).toHaveAttribute('data-type', choices[2].next!);
  const reservedQueues = await queues(page);
  await page.clock.runFor(150);
  await expect(page.locator('.plate')).toHaveCount(2);
  expect(await page.locator('.plate').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')))).toEqual(choices.slice(0, 2).map(choice => choice.food));
  await expect(page.locator('.launch-gate')).toHaveClass(/loading/);
  await page.clock.runFor(200);
  await expect(page.locator('.plate')).toHaveCount(3);
  await expect(page.locator('.launch-gate')).not.toHaveClass(/loading/);
  const plates = await page.locator('.plate').evaluateAll(nodes => nodes.map(node => ({
    food: node.getAttribute('data-type'), slot: Number(node.getAttribute('data-slot')),
  })));
  expect(plates.map(plate => plate.food)).toEqual(choices.map(choice => choice.food));
  expect(plates.map(plate => plate.slot)).toEqual([(originalSlot + 38) % 40, (originalSlot + 39) % 40, originalSlot]);
  expect(new Set(plates.map(plate => plate.slot)).size).toBe(3);
  expect(await queues(page)).toEqual(reservedQueues);
});

test('holding reserves at most one choice per repeat interval and release finishes accepted loading', async ({ page }) => {
  await start(page);
  await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
  await page.locator('.lane').nth(0).tap();
  await hold(page, 1);
  const reserved = await queues(page);
  await expect(page.locator('.launch-gate')).toHaveClass(/loading/);
  await page.clock.runFor(100);
  expect(await queues(page)).toEqual(reserved);
  await page.mouse.up();
  await page.clock.runFor(200);
  await expect(page.locator('.plate')).toHaveCount(2);
  await page.clock.runFor(600);
  expect(await queues(page)).toEqual(reserved);
  await hold(page, 2);
  const firstHeld = await queues(page);
  await page.clock.runFor(500);
  expect(await queues(page)).toEqual(firstHeld);
  await page.clock.runFor(100);
  expect(await queues(page)).not.toEqual(firstHeld);
  await page.mouse.up();
  const released = await queues(page);
  await page.clock.runFor(1000);
  expect(await queues(page)).toEqual(released);
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
  await expect(page.getByRole('dialog')).toContainText('Guests will wait');
  await expect(page.getByRole('dialog')).toContainText('A full belt keeps rolling if a plate matches a guest');
  await expect(page.getByRole('dialog')).toContainText('If no plates match, the run ends');
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
    // Let accepted plates reach customers before reserving more belt space.
    await page.clock.runFor(1500);
  }
  const served = Number(await page.locator('#served').textContent());
  expect(served).toBeGreaterThan(0);
  await page.locator('#ranking').tap();
  await expect(page.locator('.ranking-list li').first()).toContainText(`${served} ${served === 1 ? 'guest' : 'guests'}`);
  await page.reload();
  await page.locator('#modal-ranking').tap();
  await expect(page.locator('.ranking-list li').first()).toContainText(`${served} ${served === 1 ? 'guest' : 'guests'}`);
});

test('a full belt with no matching plates ends the run through ordinary lane input', async ({ page }) => {
  test.setTimeout(150000);
  await start(page);
  for (let step = 0; step < 320 && !(await page.getByRole('dialog').isVisible()); step++) {
    const requests = await page.locator('.guest').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
    const fronts = await page.locator('.lane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type') || ''));
    const lane = fronts.findIndex(front => !requests.includes(front));
    await page.keyboard.press(String((lane < 0 ? 0 : lane) + 1));
    await page.clock.runFor(550);
  }
  await expect(page.getByRole('dialog')).toContainText('no plates match');
  const requests = await page.locator('.guest').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
  const plates = await page.locator('.plate').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
  expect(plates.every(type => !requests.includes(type))).toBe(true);
  await expect(page.locator('#capacity')).toHaveText('40 / 40');
  await expect(page.locator('.plate')).toHaveCount(40);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expectSeparatedPlates(page);
    const slots = await page.locator('.plate').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-slot')));
    expect(new Set(slots).size).toBe(40);
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
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const lane of await page.locator('.lane').all()) {
      const laneBounds = await lane.boundingBox();
      expect(laneBounds).not.toBeNull();
      const previews = await lane.locator('.piece svg').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      }));
      expect(previews).toHaveLength(5);
      for (const preview of previews) {
        expect(preview.width).toBeGreaterThan(0);
        expect(preview.height).toBeGreaterThan(0);
        expect(preview.left).toBeGreaterThanOrEqual(laneBounds!.x);
        expect(preview.right).toBeLessThanOrEqual(laneBounds!.x + laneBounds!.width);
        expect(preview.top).toBeGreaterThanOrEqual(laneBounds!.y);
        expect(preview.bottom).toBeLessThanOrEqual(laneBounds!.y + laneBounds!.height);
      }
      for (let i = 0; i < previews.length; i++) for (let j = i + 1; j < previews.length; j++) {
        const a = previews[i], b = previews[j];
        expect(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left).toBe(true);
      }
    }
  }
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


const repeatingSceneAnimations = (page: Page) => page.evaluate(() =>
  document.getAnimations().filter(animation => animation.effect?.getTiming().iterations === Infinity &&
    (animation.effect as KeyframeEffect).target instanceof Element &&
    ((animation.effect as KeyframeEffect).target as Element).closest('.arena')).length);

test('character rigs breathe and blink only during active play and survive repeated restarts', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.character-head')).toHaveCount(4);
  await expect(page.locator('.character-arm-left')).toHaveCount(4);
  await expect(page.locator('.chef .chef-hand')).toHaveCount(1);
  expect(await repeatingSceneAnimations(page)).toBe(0);
  await page.locator('#primary').tap();
  await expect.poll(() => repeatingSceneAnimations(page)).toBe(10);
  for (let restart = 0; restart < 3; restart++) {
    await page.locator('#pause').tap();
    await page.waitForTimeout(500);
    expect(await repeatingSceneAnimations(page)).toBe(0);
    await page.locator('#restart').tap();
    await expect.poll(() => repeatingSceneAnimations(page)).toBe(10);
  }
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await repeatingSceneAnimations(page)).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });
  await page.locator('#primary').tap();
  await expect.poll(() => repeatingSceneAnimations(page)).toBe(10);
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => document.getAnimations().some(animation => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && !target.isConnected;
  }))).toBe(false);
});

test('matching plates trigger savoring, celebration and bounded effects that clean up', async ({ page }) => {
  test.setTimeout(60000);
  await start(page);
  await page.evaluate(() => {
    const seen = { savoring: false, blinkingDuringBite: false, celebrating: false, effects: false, maximum: 0 };
    Reflect.set(window, '__testReactions', seen);
    new MutationObserver(records => {
      for (const record of records) if (record.type === 'attributes') {
        const classes = `${record.oldValue || ''} ${(record.target as Element).getAttribute('class') || ''}`;
        seen.savoring ||= classes.includes('savoring');
        const guest = record.target as Element;
        if (guest.matches('.guest.savoring')) {
          seen.blinkingDuringBite ||= !!guest.querySelector('.character-eyes')?.getAnimations().some(animation =>
            animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity);
        }
        seen.celebrating ||= classes.includes('celebrating');
      }
      const count = document.querySelectorAll('.joy-spark, .joy-caption, .celebration-banner').length;
      seen.effects ||= count > 0;
      seen.maximum = Math.max(seen.maximum, count);
    }).observe(document.querySelector('.arena')!, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  });
  for (let step = 0; step < 100 && await page.locator('#served').textContent() === '0'; step++) {
    const needs = await page.locator('.guest').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
    const fronts = await page.locator('.lane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
    const lane = fronts.findIndex(type => needs.includes(type));
    await page.keyboard.press(String((lane >= 0 ? lane : step % 5) + 1));
    await page.clock.runFor(1500);
  }
  expect(Number(await page.locator('#served').textContent())).toBeGreaterThan(0);
  const seen = await page.evaluate(() => Reflect.get(window, '__testReactions'));
  expect(seen.savoring).toBe(true);
  expect(seen.blinkingDuringBite).toBe(true);
  expect(seen.celebrating).toBe(true);
  expect(seen.effects).toBe(true);
  expect(seen.maximum).toBeLessThanOrEqual(24);
  // WAAPI uses real compositor time even while the game clock is virtual.
  await expect(page.locator('.joy-spark, .joy-caption, .celebration-banner')).toHaveCount(0, { timeout: 3000 });
});

test('reduced motion applies at startup and live changes while tap and serve remain playable', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const clone = structuredClone.bind(window);
    Reflect.set(window, '__reducedClones', 0);
    window.structuredClone = (...args: Parameters<typeof structuredClone>) => {
      Reflect.set(window, '__reducedClones', Number(Reflect.get(window, '__reducedClones')) + 1);
      return clone(...args);
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  expect(await repeatingSceneAnimations(page)).toBe(0);
  const clones = await page.evaluate(() => {
    Reflect.set(window, '__reducedHudWrites', 0);
    new MutationObserver(records => Reflect.set(window, '__reducedHudWrites', Number(Reflect.get(window, '__reducedHudWrites')) + records.length))
      .observe(document.querySelector('.hud')!, { subtree: true, childList: true, characterData: true, attributes: true });
    return Reflect.get(window, '__reducedClones');
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => Reflect.get(window, '__reducedClones'))).toBe(clones);
  expect(await page.evaluate(() => Reflect.get(window, '__reducedHudWrites'))).toBe(0);
  await page.locator('.lane').first().tap();
  await expect(page.locator('.plate')).toHaveCount(1);
  await expect(page.locator('.joy-spark, .joy-caption, .celebration-banner')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => repeatingSceneAnimations(page)).toBe(10);
  await page.locator('#pause').tap();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => repeatingSceneAnimations(page)).toBe(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await page.locator('#primary').tap();
  const initialRemaining = await page.locator('.guest').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.getAttribute('data-remaining')), 0));
  for (let step = 0; step < 30; step++) {
    const needs = await page.locator('.guest').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
    const fronts = await page.locator('.lane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-type')));
    const lane = fronts.findIndex(type => needs.includes(type));
    await page.keyboard.press(String((lane >= 0 ? lane : step % 5) + 1));
    await page.clock.runFor(1500);
    const remaining = await page.locator('.guest').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.getAttribute('data-remaining')), 0));
    if (remaining < initialRemaining) break;
  }
  expect(await page.locator('.guest').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.getAttribute('data-remaining')), 0))).toBeLessThan(initialRemaining);
  expect(await repeatingSceneAnimations(page)).toBe(0);
  await expect(page.locator('.joy-spark, .joy-caption, .celebration-banner')).toHaveCount(0);
});
