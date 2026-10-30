# Sushi Loop

A cozy, mobile-first sushi conveyor game built with TypeScript and Vite. Five lanes, hungry guests, and an unhurried little kitchen—no accounts or external assets required.

Tap or hold a lane to send its front sushi clockwise around twelve fixed belt slots. Guests collect matching sushi as it passes and happily wait for their complete orders. Serve as many guests as you like: there is no timer. Unclaimed sushi keeps rolling, and filling the twelfth slot ends your run.

- Play with touch, mouse, or keys **1–5**; hold a lane or key to keep sending when space reaches the gate. Press **P** or **Escape** to pause and resume.
- Open **How to play** for the rules. Switching tabs pauses the game automatically.
- Your top ten runs, personal best, and optional sound preference stay on your device when browser storage is available. Local rankings count guests served.
- Responsive layouts, visible focus, dialog keyboard navigation, and reduced-motion support make the counter comfortable on phones and desktops.

## Install and play offline

Open the deployed game online once so it can download its offline files, then reload. Subsequent visits work offline after the service worker is active. Supporting browsers show an **Install** button when installation is available. On iPhone or iPad, use Safari → Share → Add to Home Screen. Ordinary browser play is always available.

New versions download in the background without interrupting a run. To use an update, reconnect online, close all Sushi Loop tabs and app windows, then reopen. Saved rankings and personal bests remain on your device unless you clear site data.

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
