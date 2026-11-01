/** Pure, seeded simulation. Positions are clockwise laps on fixed belt slots. */
export const SUSHI_TYPES = ['salmon', 'tuna', 'maki', 'shrimp', 'tamago', 'avocado', 'cucumber', 'ikura'] as const;
export type SushiType = typeof SUSHI_TYPES[number];
export type Phase = 'ready' | 'playing' | 'paused' | 'lost';
export const RULES = { capacity: 40, speed: 0.105, orderMin: 4, orderMax: 7, queueDepth: 5, laneCount: 5, replacementDelay: 1.6, repeatInterval: 0.53 } as const;
export const STATIONS = [0.125, 0.375, 0.625, 0.875] as const;
export interface Customer { id: number; type: SushiType; quantity: number; remaining: number; }
export interface Seat { customer: Customer | null; returnsIn: number; }
export interface Plate { id: number; type: SushiType; slot: number; position: number; distance: number; }
export interface GameEvent { id: number; kind: 'serve' | 'complete' | 'launch'; type?: SushiType; station?: number; }
export interface LaunchRequest { lane: number; type: SushiType; }
export interface GameState { recentOrders: SushiType[]; pending: LaunchRequest[]; phase: Phase; seed: number; rng: number; nextId: number; elapsed: number; served: number; delivered: number; beltPhase: number; queues: SushiType[][]; seats: Seat[]; plates: Plate[]; events: GameEvent[]; }
const wrap = (value: number) => ((value % 1) + 1) % 1;
function random(s: GameState): number { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return s.rng / 4294967296; }
function sushi(s: GameState): SushiType { return SUSHI_TYPES[Math.floor(random(s) * SUSHI_TYPES.length)]; }
/** Demand is shared between duplicate orders; extra travelling plates count only once. */
function unmetDemand(s: GameState): Map<SushiType, number> {
  const demand = new Map<SushiType, number>();
  for (const { customer } of s.seats) if (customer) demand.set(customer.type, (demand.get(customer.type) ?? 0) + customer.remaining);
  for (const { type } of [...s.plates, ...s.pending]) {
    const remaining = demand.get(type) ?? 0;
    if (remaining > 0) demand.set(type, remaining - 1);
  }
  return demand;
}
function hasTravellingMatch(s: GameState): boolean {
  const wanted = new Set(s.seats.flatMap(({ customer }) => customer && customer.remaining > 0 ? [customer.type] : []));
  return s.plates.some(({ type }) => wanted.has(type)) || s.pending.some(({ type }) => wanted.has(type));
}
/**
 * Keep one route to service visible. A travelling match will free a space; otherwise
 * a needed plate must be reachable before the remaining reservations run out.
 * Preserve fronts; repair a deeper preview for a missing route or a crowded-belt follow-up.
 */
function planSupply(s: GameState) {
  if (hasTravellingMatch(s)) return;
  const free = RULES.capacity - s.plates.length - s.pending.length;
  if (free <= 0) return;
  const needed = [...unmetDemand(s)].filter(([, count]) => count > 0).map(([type]) => type);
  if (!needed.length) return;
  const reachable = Math.min(free, RULES.queueDepth, 3);
  // When the belt is crowded, prepare the next front before the last useful
  // front is launched. Otherwise repeated short detours can consume the last
  // free space even when the player always follows the visible route.
  if (free <= 12 && reachable >= 2) {
    const fronts = s.queues.flatMap((queue, lane) => needed.includes(queue[0]) ? [lane] : []);
    if (fronts.length === 1) {
      const lane = fronts[0];
      const after = unmetDemand(s);
      const front = s.queues[lane][0];
      after.set(front, (after.get(front) ?? 0) - 1);
      const next = [...after].filter(([, count]) => count > 0).map(([type]) => type);
      if (next.length && !next.includes(s.queues[lane][1])) s.queues[lane][1] = next[Math.floor(random(s) * next.length)];
    }
  }
  if (s.queues.some(queue => queue.slice(0, reachable).some(type => needed.includes(type)))) return;
  // Fronts are promises to the player. If only one space remains there is no
  // safe repair without changing one, so leave that mistake unrecoverable.
  if (reachable < 2) return;
  // Randomize the lane and vary the depth, with a deeper exit later in a run.
  const lane = Math.floor(random(s) * RULES.laneCount);
  const maxDepth = Math.min(reachable - 1, s.served >= 25 ? 2 : 1);
  const depth = 1 + Math.floor(random(s) * maxDepth);
  s.queues[lane][depth] = needed[Math.floor(random(s) * needed.length)];
}
function nextSupply(s: GameState): SushiType {
  const demand = unmetDemand(s);
  for (const type of s.queues.flat()) {
    const count = demand.get(type) ?? 0;
    if (count > 0) demand.set(type, count - 1);
  }
  const missing = [...demand].filter(([, count]) => count > 0).map(([type]) => type);
  return missing.length && random(s) < .7 ? missing[Math.floor(random(s) * missing.length)] : sushi(s);
}
function customer(s: GameState): Customer {
  const counts = new Map<SushiType, number>();
  for (const { customer } of s.seats) if (customer) counts.set(customer.type, (counts.get(customer.type) ?? 0) + 1);
  const eligible = SUSHI_TYPES.filter(type => (counts.get(type) ?? 0) < 2);
  const free = RULES.capacity - s.plates.length - s.pending.length;
  // With little room and no travelling match, an accessible order can keep play
  // alive where a deeper supply repair would be too expensive or impossible.
  const reachable = new Set(s.queues.flatMap(queue => queue.slice(0, Math.min(Math.max(free, 0), 3))));
  const urgent = !hasTravellingMatch(s) && free <= 2 ? eligible.filter(type => reachable.has(type)) : [];
  const candidates = urgent.length ? urgent : eligible;
  const repeatChance = .10 + .28 * Math.min(Math.max(s.served, 0), 50) / 50;
  const repeat = random(s) < repeatChance;
  const category = candidates.filter(type => repeat ? counts.has(type) : !counts.has(type));
  const pool = category.length ? category : candidates;
  const visible = new Set(s.queues.flat());
  const preferred = pool.filter(type => visible.has(type));
  const options = preferred.length ? preferred : pool;
  // Recent orders are bounded and shared by initial seating and every arrival.
  // Penalize the last order especially strongly, and other recent repeats mildly.
  const weights = options.map(type => {
    const occurrences = s.recentOrders.filter(order => order === type).length;
    return Math.pow(.55, occurrences) * (s.recentOrders.at(-1) === type ? .08 : 1);
  });
  let draw = random(s) * weights.reduce((sum, weight) => sum + weight, 0);
  let index = 0;
  while (index < options.length - 1 && draw >= weights[index]) draw -= weights[index++];
  const type = options[index];
  s.recentOrders.push(type);
  s.recentOrders = s.recentOrders.slice(-6);
  const quantity = RULES.orderMin + Math.floor(random(s) * (RULES.orderMax - RULES.orderMin + 1));
  return { id: s.nextId++, type, quantity, remaining: quantity };
}
function event(s: GameState, detail: Omit<GameEvent, 'id'>) { s.events.push({ id: s.nextId++, ...detail }); s.events = s.events.slice(-30); }
export function createGame(seed = 42): GameState {
  const s: GameState = { recentOrders: [], pending: [], phase: 'ready', seed: seed >>> 0, rng: seed >>> 0, nextId: 1, elapsed: 0, served: 0, delivered: 0, beltPhase: 0, queues: [], seats: [], plates: [], events: [] };
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
  for (const _station of STATIONS) s.seats.push({ customer: customer(s), returnsIn: 0 });
  planSupply(s);
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
function checkBlockedBelt(s: GameState) {
  if (s.plates.length >= RULES.capacity && !s.seats.some(seat =>
    seat.customer && s.plates.some(plate => plate.type === seat.customer!.type))) s.phase = 'lost';
}
function insert(s: GameState, request: LaunchRequest) {
  const slot = entrySlot(s);
  const position = wrap(s.beltPhase + slot / RULES.capacity);
  s.plates.push({ id: s.nextId++, type: request.type, slot, position, distance: position });
  event(s, { kind: 'launch', type: request.type });
  checkBlockedBelt(s);
}
export function launchPlate(state: GameState, lane: number): GameState {
  if (!Number.isInteger(lane) || !state.queues[lane] || !canLaunch(state)) return state;
  const s = structuredClone(state);
  const request = { lane, type: s.queues[lane].shift()! };
  if (!s.pending.length && !s.plates.some(plate => plate.slot === entrySlot(s))) insert(s, request);
  else s.pending.push(request);
  s.queues[lane].push(nextSupply(s));
  if (s.phase === 'playing') planSupply(s);
  return s;
}
function step(s: GameState, dt: number) {
  let ordersChanged = false;
  s.elapsed += dt;
  const movement = RULES.speed * dt;
  s.beltPhase = wrap(s.beltPhase + movement);
  for (const seat of s.seats) {
    if (!seat.customer) {
      seat.returnsIn = Math.max(0, seat.returnsIn - dt);
      if (seat.returnsIn === 0) { seat.customer = customer(s); ordersChanged = true; }
    }
  }
  s.plates = s.plates.filter(plate => {
    const before = plate.distance; plate.distance += movement;
    plate.position = wrap(s.beltPhase + plate.slot / RULES.capacity);
    for (let i = 0; i < STATIONS.length; i++) {
      const crossing = Math.floor(before - STATIONS[i]) < Math.floor(plate.distance - STATIONS[i]);
      const guest = s.seats[i].customer;
      if (crossing && guest?.type === plate.type) {
        ordersChanged = true;
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
  checkBlockedBelt(s);
  if (ordersChanged && s.phase === 'playing') planSupply(s);
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
    const dt = Math.min(remaining, 0.05);
    step(s, dt);
    remaining -= dt;
    // The nearest slot passes the gate as the belt turns. Only fill it if free;
    // existing plates keep their slots and continue serving customers.
    if (s.phase === 'playing' && s.pending.length && !s.plates.some(plate => plate.slot === entrySlot(s))) {
      insert(s, s.pending.shift()!);
    }
  }
  return s;
}
