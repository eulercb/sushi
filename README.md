# Sushi Loop

A mobile-first sushi conveyor game built with vanilla TypeScript and Vite. Tap one of five queues to send its front plate clockwise. Guests take matching plates as they pass. Complete requests of 2–4 plates, build combos, and earn 1,200 points within a 90-second shift. Five missed guests end service; unmatched plates leave after two laps. The belt holds 12 plates.

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

`src/engine.ts` is a deterministic, browser-independent simulation. `createGame(seed)` creates a ready state; `startGame`, `launchPlate(state, lane)`, `tick(state, seconds)`, `pauseGame`, `resumeGame`, and `restartGame` return new states. The engine contains its seeded RNG state, making recorded actions reproducible. Plate positions are normalized clockwise laps starting at the belt's bottom; `STATIONS` gives the four customer positions. `events` retains the most recent 30 events, each with a unique ID for UI feedback. `src/main.ts` owns rendering, animation time, visibility pausing, and optional local best storage.
