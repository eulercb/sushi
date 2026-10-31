#!/usr/bin/env node
// Run against an already running server, with no competing browser workloads.
// This relative CPU comparison is neither a CI budget nor a battery measurement.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const usage = `Usage: node scripts/profile-performance.mjs <url> [--output results.json]
       node scripts/profile-performance.mjs --url <url> [--output results.json]

Use an HTTP(S) URL for an already running app. Set
PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a specific Chromium executable.
Results are printed as JSON lines; --output also writes the complete JSON array.`;

const metricNames = [
  'TaskDuration', 'ScriptDuration', 'LayoutDuration',
  'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount',
];

async function profile(browser, url, scenario) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  try {
    await context.addInitScript(() => {
      // Fix only the seed clock. Browser timers and performance.now stay real.
      Date.now = () => 1767268800000;
      window.__sushiProfile = { clones: 0, frames: 0 };
      const clone = window.structuredClone;
      window.structuredClone = function (...args) {
        window.__sushiProfile.clones++;
        return Reflect.apply(clone, this, args);
      };
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = function (callback) {
        // Count executed callbacks, not display frames or scheduled requests.
        // Pass invalid callbacks through so native validation stays intact.
        if (typeof callback !== 'function') return Reflect.apply(raf, this, [callback]);
        return Reflect.apply(raf, this, [function (time) {
          window.__sushiProfile.frames++;
          return Reflect.apply(callback, this, [time]);
        }]);
      };
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.bringToFront();
    if (scenario !== 'ready') {
      await page.locator('#primary').tap();
      // First order starts immediately; the remaining orders use the real queue.
      for (let i = 0; i < 35; i++) await page.keyboard.press(String(i % 5 + 1));
      await page.waitForFunction(
        () => !document.querySelector('.launch-gate.loading'),
        undefined,
        { timeout: 15_000 },
      );
      if (scenario === 'paused') await page.keyboard.press('p');
    }
    await page.waitForTimeout(1600);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]),
    );
    const before = await metrics();
    const countsBefore = await page.evaluate(() => ({ ...window.__sushiProfile }));
    const platesBefore = await page.locator('.plate').count();
    const seconds = scenario.startsWith('running') ? 8 : 4;
    await page.waitForTimeout(seconds * 1000);
    const after = await metrics();
    const countsAfter = await page.evaluate(() => ({ ...window.__sushiProfile }));
    return {
      scenario,
      seconds,
      cpu_throttle: 4,
      plates_start: platesBefore,
      plates_end: await page.locator('.plate').count(),
      ...Object.fromEntries(metricNames.map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)])),
      clones: countsAfter.clones - countsBefore.clones,
      frames: countsAfter.frames - countsBefore.frames,
      // One heap snapshot is diagnostic only; it does not measure retained memory.
      heap_bytes: after.JSHeapUsedSize ?? 0,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length > 1 || (values.url && positionals.length) || !(values.url || positionals[0])) {
    throw new Error(usage);
  }
  const url = new URL(values.url ?? positionals[0]);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('URL must use HTTP(S) and must not contain credentials.');
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const results = [];
  try {
    for (const scenario of ['ready', 'running-1', 'running-2', 'paused']) {
      const result = await profile(browser, url.href, scenario);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  } finally {
    await browser.close();
  }
  if (values.output) await writeFile(values.output, `${JSON.stringify(results, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
