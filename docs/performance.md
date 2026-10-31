# Phone rendering performance

The rendering update in `390cb6a` reduces repeated browser work while keeping the conveyor speed, 40-item capacity, loading priority, artwork, and controls intact. That optimization added no runtime dependencies. The subsequent character-animation pass adds Motion Mini; its separate comparison is recorded below.

## What changed

- Belt movement uses `translate3d` with cached arena dimensions instead of rewriting `left` and `top`. Slot coordinates are calculated once per frame and shared with plates.
- HUD text, occupancy, queue previews, and customer artwork update when their values change. The capacity bar animates its scale instead of its width, avoiding layout work during that animation.
- The app advances exclusively owned simulation state in place. The exported immutable `tick()` still clones and delegates to the same simulation implementation, preserving its API and test contract.
- The animation loop stops on the welcome screen, while paused, after game over, and when hidden. Resize updates still run when needed.

## Measured comparison

Baseline: commit `333ed22`. Both production builds were measured sequentially without competing game browsers, using the same headless Chromium, a 390 × 844 viewport, device pixel ratio 2, and 4× CPU throttling. The script fixes the random seed clock but uses real browser timers. It fills the belt through 35 ordinary keyboard inputs, lets loading settle, and records two eight-second active samples. Both builds had 31 plates at measurement start and 16 at the end.

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Main-thread task time per 8-second active sample, mean | 7,228 ms | 4,062 ms |
| Layout operations per active sample, mean | 445 | 24 |
| State copies per active sample, mean | 444 | 0 |
| JavaScript animation callbacks on welcome screen, 4 seconds | 244 | 0 |
| JavaScript animation callbacks while paused, 4 seconds | 241 | 0 |

This is approximately 44% less main-thread task time and 95% fewer layout operations in this workload. Active animation callback counts remained near the display cadence; the improvement does not come from slowing the game. Callback counts are not a measurement of displayed FPS.

These are relative desktop Chrome measurements with CPU throttling, not physical-phone temperature, battery, GPU, or retained-memory measurements. Device and browser results can differ. Raw measurements are in [baseline.json](performance/baseline.json) and [optimized.json](performance/optimized.json).

## Character-animation pass

The richer original SVG portraits use Motion Mini (`motion/mini`) for native Web Animations. Breathing runs on HTML wrappers and bite reactions on the outer avatar: continuously transforming SVG rigs, or transforming a head for every bite, caused avoidable layout work in the initial prototype. Blinks use opacity. Articulated SVG head and arm poses are reserved for short order-completion cheers.

Ten native idle animations run only during visible, active play. There is no additional JavaScript animation-frame loop. Pause, restart, tab hiding, and live reduced-motion changes cancel native controls and restore their original poses. Sparkles and captions share a 24-node cap and expire within one second. Reduced motion suppresses these effects while retaining the playable game.

A fresh comparison used the same viewport, 4× CPU throttle, 35-input workload, and two eight-second samples as above, run sequentially without competing game browsers. Both versions began with 31 plates and ended with 16.

| Metric | Optimized before animation (`390cb6a`) | Animated |
| --- | ---: | ---: |
| Main-thread task time per active sample, mean | 4,036 ms | 5,000 ms |
| Layout operations per active sample, mean | 24 | 108 |
| State copies per active sample | 0 | 0 |
| JavaScript animation callbacks on welcome screen / paused, 4 seconds each | 0 / 0 | 0 / 0 |

The animation pass costs approximately 24% more active main-thread time than the lean optimized build in this workload. It remains approximately 31% below the original pre-optimization measurement; that older comparison came from a separate run. This is a visual upgrade with measurable processing cost, not a new performance optimization. The production JavaScript grows from about 11.35 KB to 17.95 KB gzipped, including the richer SVG artwork and Motion Mini. Raw measurements: [animation-baseline.json](performance/animation-baseline.json) and [animated.json](performance/animated.json).

## Reproduce

Install Chromium with `npx playwright install chromium` if it is not already available. Build and serve each revision on its own local port. For a root deployment:

```sh
BASE_PATH=/ npm run build
BASE_PATH=/ npm run preview -- --port 4173 --strictPort
```

In another terminal, run:

```sh
node scripts/profile-performance.mjs http://127.0.0.1:4173/ --output /tmp/sushi-performance.json
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` to use this cloud environment's installed Chromium. Run each revision sequentially, with the same browser and no competing browser workloads. Compare the two active samples rather than a single best result. The benchmark is a development tool, not a timing budget in CI.

Regression tests cover idle-loop suspension, clone-free motion, unchanged HUD mutations, correct capacity-bar fill, and the existing gameplay, resize, touch, ranking, and offline behavior.
