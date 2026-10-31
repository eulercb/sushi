import { describe, it, expect } from 'vitest';
import { createGame, startGame, launchPlate, tick, pauseGame, resumeGame, restartGame, canLaunch, RULES, SUSHI_TYPES } from './engine';
const playing = () => startGame(createGame(71));
const noMatch = () => { const s = playing(); s.seats.forEach(seat => { seat.customer!.type = 'tuna'; }); s.queues.forEach(queue => queue.fill('salmon')); return s; };
describe('cozy sushi service', () => {
  it('mixes all eight varieties into exactly five preview lanes with varied seeded fronts', () => {
    expect(SUSHI_TYPES).toHaveLength(8);
    const fronts = new Set<string>();
    const requests = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const s = createGame(seed);
      expect(s.queues).toHaveLength(RULES.laneCount);
      expect(RULES.laneCount).toBe(5);
      expect(s.queues.every(queue => queue.length === RULES.queueDepth)).toBe(true);
      expect(new Set(s.queues.flat())).toEqual(new Set(SUSHI_TYPES));
      expect(new Set(s.queues.map(queue => queue[0])).size).toBe(5);
      s.queues.forEach(queue => fronts.add(queue[0]));
      s.seats.forEach(seat => requests.add(seat.customer!.type));
    }
    expect(fronts).toEqual(new Set(SUSHI_TYPES));
    expect(requests).toEqual(new Set(SUSHI_TYPES));
  });
  it.each(['avocado', 'cucumber', 'ikura'] as const)('launches and serves %s without mutating the input', type => {
    const initial = noMatch();
    initial.queues[0][0] = type;
    initial.seats[0].customer!.type = type;
    initial.seats[0].customer!.remaining = 1;
    const snapshot = structuredClone(initial);
    const launched = launchPlate(initial, 0);
    expect(launched.plates[0].type).toBe(type);
    expect(launched.queues[0]).toHaveLength(RULES.queueDepth);
    expect(SUSHI_TYPES).toContain(launched.queues[0].at(-1));
    const served = tick(launched, 1.7);
    expect(served.plates).toHaveLength(0);
    expect(served.served).toBe(1);
    expect(served.delivered).toBe(1);
    expect(served.seats[0].customer).toBeNull();
    expect(initial).toEqual(snapshot);
  });
  it('replays seeded state and leaves inputs untouched', () => { const a = playing(); const snapshot = structuredClone(a); expect(tick(launchPlate(a, 2), 3)).toEqual(tick(launchPlate(playing(), 2), 3)); expect(a).toEqual(snapshot); });
  it('lets customers wait indefinitely and never removes unmatched plates', () => { const initial = noMatch(); const s = tick(launchPlate(initial, 0), 180); expect(s.phase).toBe('playing'); expect(s.seats).toEqual(initial.seats); expect(s.plates).toHaveLength(1); expect(s.plates[0].distance).toBeGreaterThan(10); expect(s.served).toBe(0); });
  it('moves plates a quarter lap at the faster belt speed', () => { const s = tick(launchPlate(noMatch(), 0), .25 / .105); expect(RULES.speed).toBe(.105); expect(s.plates[0].distance).toBeCloseTo(.25); expect(s.plates[0].position).toBeCloseTo(.25); });
  it('generates orders of four to seven pieces across seeded games', () => { const quantities = Array.from({ length: 100 }, (_, seed) => createGame(seed).seats.map(seat => seat.customer!.quantity)).flat(); expect(Math.min(...quantities)).toBe(4); expect(Math.max(...quantities)).toBe(7); expect(quantities.every(quantity => quantity >= RULES.orderMin && quantity <= RULES.orderMax)).toBe(true); });
  it('blocks an occupied gate without shifting queues or consuming random state', () => { const s = launchPlate(playing(), 0); expect(canLaunch(s)).toBe(false); expect(launchPlate(s, 1)).toBe(s); expect(s.queues.every(queue => queue.length === RULES.queueDepth)).toBe(true); expect(canLaunch(tick(s, 1 / RULES.capacity / RULES.speed))).toBe(true); });
  it('fills every spaced slot and ends immediately at capacity', () => { let s = noMatch(); for (let i = 0; i < RULES.capacity; i++) { s.queues[0][0] = 'salmon'; s = launchPlate(s, 0); if (i < RULES.capacity - 1) s = tick(s, 1 / RULES.capacity / RULES.speed); } expect(s.plates).toHaveLength(RULES.capacity); expect(new Set(s.plates.map(p => p.slot)).size).toBe(RULES.capacity); expect(s.phase).toBe('lost'); expect(launchPlate(s, 0)).toBe(s); expect(tick(s, 20)).toBe(s); const positions = s.plates.map(p => p.position).sort((a,b) => a-b); for (let i = 0; i < positions.length; i++) expect((positions[(i+1)%RULES.capacity] - positions[i] + 1) % 1).toBeCloseTo(1/RULES.capacity); });
  it('feeds matching requests, frees their slot and counts completed customers only', () => { let s = noMatch(); s.seats[0].customer!.type = 'salmon'; s.seats[0].customer!.remaining = 2; s = tick(launchPlate(s, 0), 1.7); expect(s.plates).toHaveLength(0); expect(s.delivered).toBe(1); expect(s.served).toBe(0); const guest = s.seats[0].customer!; guest.remaining = 1; const id = guest.id; s = tick(launchPlate(s, 0), 14); expect(s.served).toBeGreaterThanOrEqual(1); expect(s.seats[0].customer?.id).not.toBe(id); expect(s.events.some(e => e.kind === 'complete')).toBe(true); });
  it('replaces completed customers after a gentle delay with available orders', () => { let s = noMatch(); s.seats[0].customer!.type = 'salmon'; s.seats[0].customer!.remaining = 1; s = tick(launchPlate(s, 0), 1.7); expect(s.served).toBe(1); expect(s.seats[0].customer).toBeNull(); s = tick(s, 1.7); const guest = s.seats[0].customer!; expect(guest.quantity).toBeGreaterThanOrEqual(RULES.orderMin); expect(guest.quantity).toBeLessThanOrEqual(RULES.orderMax); expect(s.queues.flat()).toContain(guest.type); });
  it('freezes ready, paused and lost states and restarts deterministically', () => { const s = pauseGame(tick(launchPlate(playing(), 0), 5)); expect(tick(s, 10)).toBe(s); expect(launchPlate(s, 1)).toBe(s); expect(tick(createGame(), 10).elapsed).toBe(0); expect(tick(resumeGame(s), 1).elapsed).toBeCloseTo(6); expect(restartGame(s)).toEqual(playing()); });
  it('preserves slot spacing through wraps over a long deterministic run', () => { const run = () => { let s = playing(); for (let i = 0; i < 2400; i++) { if (i % 15 === 0) s = launchPlate(s, i % 5); s = tick(s, .1); expect(s.plates.length).toBeLessThanOrEqual(RULES.capacity); expect(new Set(s.plates.map(p => p.slot)).size).toBe(s.plates.length); for (const plate of s.plates) { expect(plate.position).toBeGreaterThanOrEqual(0); expect(plate.position).toBeLessThan(1); expect(plate.position).toBeCloseTo((s.beltPhase + plate.slot / RULES.capacity) % 1); } } return s; }; expect(run()).toEqual(run()); });
  it('handles invalid input and equivalent large ticks', () => { const s = playing(); expect(launchPlate(s, -1)).toBe(s); expect(launchPlate(s, .5)).toBe(s); expect(tick(s, NaN)).toBe(s); expect(tick(s, -1)).toBe(s); const a = tick(s, 5); let b = s; for (let i = 0; i < 100; i++) b = tick(b, .05); expect(a.elapsed).toBeCloseTo(b.elapsed); expect(a.seats).toEqual(b.seats); });
});
