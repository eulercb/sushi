# Sushi Loop

A cozy, mobile-first sushi conveyor game built with TypeScript and Vite. Eight sushi varieties across five lanes, hungry guests, and an unhurried little kitchen—no accounts or external assets required.

Tap or hold a lane to send its front sushi clockwise around forty fixed belt slots. Guests collect matching sushi as it passes and happily wait for their complete orders of 4–7 pieces. Serve as many guests as you like: there is no timer. Unclaimed sushi keeps rolling. When all forty slots are full, the belt keeps moving if any plate matches a current guest; otherwise the run ends. You can add more sushi once a guest frees a slot. Different guests can request the same sushi: the chance of repeating an active request starts at 10%, rises linearly to 65% after 50 guests served, and then stays at 65%. Repeated requests prefer sushi already in the lanes; otherwise new requests prefer unrequested sushi in the lanes.

The seeded supply quietly favors remaining orders, counting shared orders and sushi already on the belt or waiting to enter it. When no matching sushi is travelling, it maintains a route to a requested piece within the available spaces where possible, at most two pieces behind a lane front. When space is tight it can also prepare a follow-up to the last useful front. These safeguards may replace a deeper preview; the five lane fronts and accepted choices are never rewritten. With only one space left and no matching front or travelling plate, there is no room for such a repair. Unmatched choices can still fill the belt and end a run, so watch the orders and visible lanes.

- Serve salmon, tuna, maki, shrimp, tamago, avocado maki, cucumber maki, and ikura gunkan. Every lane mixes varieties, with a fresh seeded selection each run.
- Play with touch, mouse, or keys **1–5**; hold a lane or key to send at a steady pace. Quick taps reserve their selected sushi in order; each joins the moving belt as an empty slot passes the gate. Press **P** or **Escape** to pause and resume.
- Open **How to play** for the rules. Switching tabs pauses the game automatically.
- Your top ten runs, personal best, and optional sound preference stay on your device when browser storage is available. Local rankings count guests served.
- Responsive layouts, visible focus, dialog keyboard navigation, and reduced-motion support make the counter comfortable on phones and desktops.

## Install and play offline

Open the deployed game online once so it can download its offline files, then reload. Subsequent visits work offline after the service worker is active. Supporting browsers show an **Install** button when installation is available. On iPhone or iPad, use Safari → Share → Add to Home Screen. Ordinary browser play is always available.

New versions download in the background without interrupting a run. Choose **Update & restart** when it appears to start a fresh run with the update. Saved rankings and personal bests remain on your device unless you clear site data.

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

See [performance notes](docs/performance.md) for the phone-rendering improvements, measured comparison, and reproducible profiling command.

`src/engine.ts` contains the deterministic simulation and seeded random state. Its immutable state transitions are independent of the browser and covered by unit tests. `src/main.ts` owns rendering, animation, accessibility, sound, and optional local storage. `src/art.ts` provides the original inline SVG illustrations; `src/style.css` handles responsive presentation.

`src/pwa.ts` registers the production service worker and connects browser installation events. `public/sw.js` caches a complete release; the Vite build plugin injects the generated asset list and a content hash so HTML and assets stay in sync. Updates activate after the complete download without reloading an open game. No external fonts or runtime services are required.

## Deployment

GitHub Actions tests and builds pushes to `main`, runs Chromium smoke tests, and deploys to GitHub Pages. Select **GitHub Actions** as the repository's Pages source once. The workflow reads the configured Pages URL to build and test at `/` for `sushi.zen.dev.br`, or `/sushi/` for the GitHub project URL. See [deployment instructions](docs/deployment.md) for setup, DNS, offline verification, updates, and custom paths. Local builds default to `/sushi/`; verify a domain root with `BASE_PATH=/ npm run build` followed by `BASE_PATH=/ npm run test:e2e`.

## Character animation

Original SVG characters breathe, blink, savor each bite, and cheer when an order is complete. The chef flicks a hand as sushi is accepted; newly loaded sushi settles into its plate. Every fifth happy guest earns a little celebratory ribbon.

`src/animations.ts` uses Motion Mini's native Web Animations for transforms and opacity. Scene loops and transient effects cancel on pause, restart, tab hiding, and live reduced-motion preference changes. Effects have a shared 24-node limit and last at most one second; belt movement keeps its existing renderer. Reduced motion retains the illustrated smiles and clear order feedback without moving celebrations.

When an update is ready, choose **Update & restart** to apply it and start a fresh run. Older installed versions without this button may need another reload after the update downloads.
