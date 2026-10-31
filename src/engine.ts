/** Pure, seeded simulation. Positions are clockwise laps on fixed belt slots. */
export const SUSHI_TYPES = ['salmon', 'tuna', 'maki', 'shrimp', 'tamago', 'avocado', 'cucumber', 'ikura'] as const;
export type SushiType = typeof SUSHI_TYPES[number];
export type Phase = 'ready' | 'playing' | 'paused' | 'lost';
export const RULES = { capacity: 40, speed: 0.105, orderMin: 4, orderMax: 7, queueDepth: 5, laneCount: 5, replacementDelay: 1.6, loadingDuration: 0.2, repeatInterval: 0.53 } as const;
export const STATIONS = [0.125, 0.375, 0.625, 0.875] as const;
export interface Customer { id: number; type: SushiType; quantity: number; remaining: number; }
export interface Seat { customer: Customer | null; returnsIn: number; }
export interface Plate { id: number; type: SushiType; slot: number; position: number; distance: number; }
export interface GameEvent { id: number; kind: 'serve' | 'complete' | 'launch'; type?: SushiType; station?: number; }
export interface LaunchRequest { lane: number; type: SushiType; }
export interface GameState { pending: LaunchRequest[]; loadingRemaining: number; phase: Phase; seed: number; rng: number; nextId: number; elapsed: number; served: number; delivered: number; beltPhase: number; queues: SushiType[][]; seats: Seat[]; plates: Plate[]; events: GameEvent[]; }
const wrap = (value: number) => ((value % 1) + 1) % 1;
function random(s: GameState): number { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return s.rng / 4294967296; }
function sushi(s: GameState): SushiType { return SUSHI_TYPES[Math.floor(random(s) * SUSHI_TYPES.length)]; }
function customer(s: GameState): Customer {
  const available = [...new Set(s.queues.flat())];
  const type = available[Math.floor(random(s) * available.length)];
  const quantity = RULES.orderMin + Math.floor(random(s) * (RULES.orderMax - RULES.orderMin + 1));
  return { id: s.nextId++, type, quantity, remaining: quantity };
}
function event(s: GameState, detail: Omit<GameEvent, 'id'>) { s.events.push({ id: s.nextId++, ...detail }); s.events = s.events.slice(-30); }
export function createGame(seed = 42): GameState {
  const s: GameState = { pending: [], loadingRemaining: 0, phase: 'ready', seed: seed >>> 0, rng: seed >>> 0, nextId: 1, elapsed: 0, served: 0, delivered: 0, beltPhase: 0, queues: [], seats: [], plates: [], events: [] };
  // A seeded bag gives every variety a place in the previews, with five distinct fronts.
  const bag: SushiType[] = [];
  while (bag.length < RULES.laneCount * RULES.queueDepth) {
    const batch = [...SUSHI_TYPES];
    for (let i = batch.length - 1; i > 0; i--) {
      const j = Math.floor(random(s) * (i + 1));
      [batch[i], batch[j]] = [batch[j], batch[i]];
    }
    bag.push(...batch);
  }
  s.queues = Array.from({ length: RULES.laneCount }, (_, lane) =>
    Array.from({ length: RULES.queueDepth }, (_, depth) => bag[depth * RULES.laneCount + lane]));
  s.seats = STATIONS.map(() => ({ customer: customer(s), returnsIn: 0 }));
  return s;
}
export function startGame(s: GameState): GameState { return s.phase === 'ready' ? { ...s, phase: 'playing' } : s; }
export function pauseGame(s: GameState): GameState { return s.phase === 'playing' ? { ...s, phase: 'paused' } : s; }
export function resumeGame(s: GameState): GameState { return s.phase === 'paused' ? { ...s, phase: 'playing' } : s; }
export function restartGame(s: GameState, seed = s.seed): GameState { return startGame(createGame(seed)); }
/** Exactly one slot is nearest the loading gate, including across the lap boundary. */
function entrySlot(s: GameState): number { return ((Math.round(-s.beltPhase * RULES.capacity) % RULES.capacity) + RULES.capacity) % RULES.capacity; }
/** Each accepted request reserves one belt space and its exact queue front. */
export function canLaunch(s: GameState): boolean { return s.phase === 'playing' && s.plates.length + s.pending.length < RULES.capacity; }
export function canRepeatLaunch(s: GameState): boolean { return canLaunch(s) && s.pending.length === 0; }
function insert(s: GameState, request: LaunchRequest) {
  const slot = entrySlot(s);
  const chain: Plate[] = [];
  for (let offset = 0; offset < RULES.capacity; offset++) {
    const plate = s.plates.find(p => p.slot === (slot - offset + RULES.capacity) % RULES.capacity);
    if (!plate) break;
    chain.push(plate);
  }
  // Back the queue up atomically: reverse movement never serves customer stations.
  // Moving distance with position prevents retroactive crossings on the next tick.
  for (const plate of chain) {
    plate.slot = (plate.slot - 1 + RULES.capacity) % RULES.capacity;
    plate.distance -= 1 / RULES.capacity;
    plate.position = wrap(s.beltPhase + plate.slot / RULES.capacity);
  }
  const position = wrap(s.beltPhase + slot / RULES.capacity);
  s.plates.push({ id: s.nextId++, type: request.type, slot, position, distance: position });
  event(s, { kind: 'launch', type: request.type });
  if (s.plates.length === RULES.capacity) s.phase = 'lost';
}
export function launchPlate(state: GameState, lane: number): GameState {
  if (!Number.isInteger(lane) || !state.queues[lane] || !canLaunch(state)) return state;
  const s = structuredClone(state);
  const request = { lane, type: s.queues[lane].shift()! };
  s.queues[lane].push(sushi(s));
  if (!s.pending.length && !s.plates.some(plate => plate.slot === entrySlot(s))) insert(s, request);
  else {
    s.pending.push(request);
    if (s.pending.length === 1) s.loadingRemaining = RULES.loadingDuration;
  }
  return s;
}
function step(s: GameState, dt: number) {
  s.elapsed += dt;
  const movement = RULES.speed * dt;
  s.beltPhase = wrap(s.beltPhase + movement);
  for (const seat of s.seats) {
    if (!seat.customer) {
      seat.returnsIn = Math.max(0, seat.returnsIn - dt);
      if (seat.returnsIn === 0) seat.customer = customer(s);
    }
  }
  s.plates = s.plates.filter(plate => {
    const before = plate.distance; plate.distance += movement;
    plate.position = wrap(s.beltPhase + plate.slot / RULES.capacity);
    for (let i = 0; i < STATIONS.length; i++) {
      const crossing = Math.floor(before - STATIONS[i]) < Math.floor(plate.distance - STATIONS[i]);
      const guest = s.seats[i].customer;
      if (crossing && guest?.type === plate.type) {
        guest.remaining--; s.delivered++;
        event(s, { kind: 'serve', station: i, type: plate.type });
        if (guest.remaining === 0) {
          s.served++;
          s.seats[i] = { customer: null, returnsIn: RULES.replacementDelay };
          event(s, { kind: 'complete', station: i, type: plate.type });
        }
        return false;
      }
    }
    return true;
  });
}
/** Subdivision preserves station crossings and customer replacement for large ticks. */
export function tick(state: GameState, seconds: number): GameState {
  if (state.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return state;
  return advanceGameInPlace(structuredClone(state), seconds);
}
/** Advance exclusively owned state without cloning; callers must not share snapshots. */
export function advanceGameInPlace(s: GameState, seconds: number): GameState {
  if (s.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return s;
  let remaining = seconds;
  while (remaining > 1e-9 && s.phase === 'playing') {
    if (s.pending.length) {
      const dt = Math.min(remaining, s.loadingRemaining);
      s.elapsed += dt; s.loadingRemaining -= dt; remaining -= dt;
      if (s.loadingRemaining < 1e-9) {
        insert(s, s.pending.shift()!);
        s.loadingRemaining = s.pending.length ? RULES.loadingDuration : 0;
      }
    } else { const dt = Math.min(remaining, 0.05); step(s, dt); remaining -= dt; }
  }
  return s;
}
