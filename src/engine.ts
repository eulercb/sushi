/** Pure simulation. All public transitions return a new state; positions are clockwise laps. */
export const SUSHI_TYPES = ['salmon', 'tuna', 'maki', 'shrimp', 'tamago'] as const;
export type SushiType = typeof SUSHI_TYPES[number];
export type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';
export const RULES = { duration: 90, goal: 1200, capacity: 12, speed: 0.105, patience: 28, maxMisses: 5, queueDepth: 5, replacementDelay: 1.6, maxLaps: 2, launchCooldown: 0.16 } as const;
export const STATIONS = [0.125, 0.375, 0.625, 0.875] as const;
export interface Customer { id: number; type: SushiType; quantity: number; remaining: number; patience: number; maxPatience: number; }
export interface Seat { customer: Customer | null; returnsIn: number; }
export interface Plate { id: number; type: SushiType; position: number; distance: number; }
export interface GameEvent { id: number; kind: 'serve' | 'complete' | 'miss' | 'waste' | 'launch'; type?: SushiType; station?: number; points?: number; }
export interface GameState { phase: Phase; seed: number; rng: number; nextId: number; elapsed: number; score: number; coins: number; combo: number; bestCombo: number; served: number; misses: number; wasted: number; launchCooldown: number; queues: SushiType[][]; seats: Seat[]; plates: Plate[]; events: GameEvent[]; }
function random(s: GameState): number { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return s.rng / 4294967296; }
function sushi(s: GameState): SushiType { return SUSHI_TYPES[Math.floor(random(s) * SUSHI_TYPES.length)]; }
function customer(s: GameState): Customer { const type = sushi(s); const quantity = 2 + Math.floor(random(s) * 3); return { id: s.nextId++, type, quantity, remaining: quantity, patience: RULES.patience, maxPatience: RULES.patience }; }
function event(s: GameState, detail: Omit<GameEvent, 'id'>) { s.events.push({ id: s.nextId++, ...detail }); s.events = s.events.slice(-30); }
export function createGame(seed = 42): GameState {
  const s: GameState = { phase: 'ready', seed: seed >>> 0, rng: seed >>> 0, nextId: 1, elapsed: 0, score: 0, coins: 0, combo: 0, bestCombo: 0, served: 0, misses: 0, wasted: 0, launchCooldown: 0, queues: [], seats: [], plates: [], events: [] };
  s.queues = SUSHI_TYPES.map(type => [type, ...Array.from({ length: RULES.queueDepth - 1 }, () => sushi(s))]);
  s.seats = STATIONS.map(() => ({ customer: customer(s), returnsIn: 0 }));
  return s;
}
export function startGame(s: GameState): GameState { return s.phase === 'ready' ? { ...s, phase: 'playing' } : s; }
export function pauseGame(s: GameState): GameState { return s.phase === 'playing' ? { ...s, phase: 'paused' } : s; }
export function resumeGame(s: GameState): GameState { return s.phase === 'paused' ? { ...s, phase: 'playing' } : s; }
export function restartGame(s: GameState, seed = s.seed): GameState { return startGame(createGame(seed)); }
export function launchPlate(state: GameState, lane: number): GameState {
  if (state.phase !== 'playing' || !Number.isInteger(lane) || !state.queues[lane] || state.plates.length >= RULES.capacity || state.launchCooldown > 0) return state;
  const s = structuredClone(state); const type = s.queues[lane].shift()!;
  s.queues[lane].push(sushi(s)); s.plates.push({ id: s.nextId++, type, position: 0, distance: 0 }); s.launchCooldown = RULES.launchCooldown;
  event(s, { kind: 'launch', type }); return s;
}
function step(s: GameState, dt: number) {
  s.elapsed = Math.min(RULES.duration, s.elapsed + dt);
  if (RULES.duration - s.elapsed < 1e-8) s.elapsed = RULES.duration;
  s.launchCooldown = Math.max(0, s.launchCooldown - dt);
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i];
    if (!seat.customer) { seat.returnsIn -= dt; if (seat.returnsIn <= 0) seat.customer = customer(s); }
    else { seat.customer.patience -= dt; if (seat.customer.patience <= 0) { event(s, { kind: 'miss', station: i }); seat.customer = null; seat.returnsIn = RULES.replacementDelay; s.misses++; s.combo = 0; } }
  }
  s.plates = s.plates.filter(plate => {
    const before = plate.distance; plate.distance += RULES.speed * dt; plate.position = plate.distance % 1;
    for (let i = 0; i < STATIONS.length; i++) {
      const station = STATIONS[i]; const crossing = Math.floor(before - station) < Math.floor(plate.distance - station);
      const guest = s.seats[i].customer;
      if (crossing && guest?.type === plate.type) {
        guest.remaining--; guest.patience = Math.min(guest.maxPatience, guest.patience + 2); s.score += 20;
        event(s, { kind: 'serve', station: i, type: plate.type, points: 20 });
        if (guest.remaining === 0) {
          s.combo++; s.bestCombo = Math.max(s.bestCombo, s.combo); s.served++;
          const bonus = 80 + Math.min(s.combo - 1, 5) * 10; s.score += bonus; s.coins += 5 + Math.min(s.combo, 5);
          s.seats[i] = { customer: null, returnsIn: RULES.replacementDelay };
          event(s, { kind: 'complete', station: i, type: plate.type, points: bonus });
        }
        return false;
      }
    }
    if (plate.distance >= RULES.maxLaps) { s.wasted++; s.combo = 0; event(s, { kind: 'waste', type: plate.type }); return false; }
    return true;
  });
  if (s.score >= RULES.goal) s.phase = 'won';
  else if (s.elapsed >= RULES.duration || s.misses >= RULES.maxMisses) s.phase = 'lost';
}
/** Advance seconds, subdividing to preserve station crossing and patience behavior. */
export function tick(state: GameState, seconds: number): GameState {
  if (state.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return state;
  const s = structuredClone(state); let remaining = Math.min(seconds, RULES.duration - s.elapsed);
  while (remaining > 1e-9 && s.phase === 'playing') { const dt = Math.min(remaining, 0.05); step(s, dt); remaining -= dt; }
  return s;
}
