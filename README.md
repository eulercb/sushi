# Sushi Loop

A cozy, mobile-first sushi conveyor game built with TypeScript and Vite. Five lanes, hungry guests, and a little lunch-hour rush—no accounts or external assets required.

Tap a lane to send its front plate clockwise around the belt. Guests collect matching sushi as it passes. Complete orders of 2–4 plates, build combos, and reach 1,200 points in a 90-second shift. Five missed guests end service. The belt holds 12 plates; unclaimed plates leave after two laps.

- Play with touch, mouse, or keys **1–5**. Press **P** or **Escape** to pause and resume.
- Open **How to play** for the rules. Switching tabs pauses the shift automatically.
- Optional sound, personal best, and sound preference stay on your device when browser storage is available.
- Responsive layouts, visible focus, dialog keyboard navigation, and reduced-motion support make the counter comfortable on phones and desktops.

## Install and play offline

Open the deployed game online once so it can download its offline files, then reload. Subsequent visits work offline after the service worker is active. Supporting browsers show an **Install** button when installation is available. On iPhone or iPad, use Safari → Share → Add to Home Screen. Ordinary browser play is always available.

New versions download in the background without interrupting a shift. To use an update, reconnect online, close all Sushi Loop tabs and app windows, then reopen. Saved personal bests remain on your device unless you clear site data.

## Development

Use **Node.js 20.19+ or 22.12+**; CI uses Node 22. Install dependencies with the committed lockfile:

```sh
npm ci
npm run dev
```

The development server prints its URL; the default project path is `/sushi/`. Service workers register only in production builds.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run check` runs all four verification steps, including the production build and browser tests. Playwright starts a local preview server automatically. To inspect the build yourself, run `npm run preview` and open `http://localhost:4173/sushi/`. Browser tests cover gameplay, keyboard interaction, mobile layout, installation assets, and offline reloads.

## Architecture

`src/engine.ts` contains the deterministic simulation and seeded random state. Its immutable state transitions are independent of the browser and covered by unit tests. `src/main.ts` owns rendering, animation, accessibility, sound, and optional local storage. `src/art.ts` provides the original inline SVG illustrations; `src/style.css` handles responsive presentation.

`src/pwa.ts` registers the production service worker and connects browser installation events. `public/sw.js` caches a complete release; the Vite build plugin injects the generated asset list and a content hash so HTML and assets stay in sync. Updates activate after existing app windows close. No external fonts or runtime services are required.

## Deployment

GitHub Actions tests and builds pushes to `main`, runs Chromium smoke tests, and deploys to GitHub Pages. Select **GitHub Actions** as the repository's Pages source once. See [deployment instructions](docs/deployment.md) for setup, offline verification, updates, and custom paths. The default build path is `/sushi/`; use `BASE_PATH=/ npm run build` for a domain root.
