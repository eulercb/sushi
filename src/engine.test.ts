import { describe, it, expect } from 'vitest';
import { createGame, startGame, launchPlate, tick, advanceGameInPlace, pauseGame, resumeGame, restartGame, canLaunch, canRepeatLaunch, RULES, SUSHI_TYPES } from './engine';
const C = RULES.capacity;
const playing = () => startGame(createGame(71));
const noMatch = () => { const s = playing(); s.seats.forEach(seat => { seat.customer!.type = 'tuna'; }); s.queues.forEach(queue => queue.fill('salmon')); return s; };
describe('cozy sushi service', () => {
  it('advances owned state identically to immutable ticks through seeded mixed actions', () => {
    for (const seed of [0, 71, 4294967295]) {
      let immutable = startGame(createGame(seed));
      let owned = structuredClone(immutable);
      for (let i = 0; i < 300; i++) {
        if (i % 4 === 0) {
          immutable = launchPlate(immutable, i % RULES.laneCount);
          owned = launchPlate(owned, i % RULES.laneCount);
        }
        if (i % 37 === 0) {
          immutable = pauseGame(immutable); owned = pauseGame(owned);
        } else if (i % 37 === 1) {
          immutable = resumeGame(immutable); owned = resumeGame(owned);
        }
        const before = structuredClone(immutable);
        const input = immutable;
        const seconds = [.016, .1, .2, 1.7][i % 4];
        immutable = tick(input, seconds);
        expect(input).toEqual(before);
        expect(advanceGameInPlace(owned, seconds)).toBe(owned);
        expect(owned).toEqual(immutable);
      }
    }
  });
  it('keeps both advancement APIs unchanged for frozen phases and invalid durations', () => {
    const active = launchPlate(launchPlate(playing(), 0), 1);
    const states = [createGame(), pauseGame(active), { ...structuredClone(active), phase: 'lost' as const }];
    for (const state of states) {
      const before = structuredClone(state);
      expect(advanceGameInPlace(state, 10)).toBe(state);
      expect(tick(state, 10)).toBe(state);
      expect(state).toEqual(before);
    }
    for (const seconds of [NaN, Infinity, -Infinity, 0, -1]) {
      const state = structuredClone(active);
      const before = structuredClone(state);
      expect(advanceGameInPlace(state, seconds)).toBe(state);
      expect(tick(state, seconds)).toBe(state);
      expect(state).toEqual(before);
    }
  });
  it('preserves loading, service and replacement across large and subdivided advances', () => {
    let initial = noMatch();
    initial.seats[0].customer!.type = 'salmon';
    initial.seats[0].customer!.remaining = 1;
    for (let i = 0; i < 4; i++) initial = launchPlate(initial, 0);
    const large = advanceGameInPlace(structuredClone(initial), 5);
    const small = structuredClone(initial);
    for (let i = 0; i < 100; i++) advanceGameInPlace(small, .05);
    expect(large.served).toBeGreaterThan(0);
    expect(large.pending).toEqual([]);
    expect(large.seats).toEqual(small.seats);
    expect(large.events).toEqual(small.events);
    expect(large.rng).toBe(small.rng);
    expect(large.queues).toEqual(small.queues);
    expect(large.elapsed).toBeCloseTo(small.elapsed, 10);
    expect(large.beltPhase).toBeCloseTo(small.beltPhase, 10);
    expect(large.plates).toHaveLength(small.plates.length);
    large.plates.forEach((plate, i) => {
      expect(plate.id).toBe(small.plates[i].id);
      expect(plate.type).toBe(small.plates[i].type);
      expect(plate.slot).toBe(small.plates[i].slot);
      expect(plate.position).toBeCloseTo(small.plates[i].position, 10);
      expect(plate.distance).toBeCloseTo(small.plates[i].distance, 10);
    });
    expect(tick(initial, 5)).toEqual(large);
  });
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
  it('uses the seeded progressive repeat probability and prefers types in the queue', () => {
    // These RNG states give first draws of about .236 and .623, respectively.
    for (const [served, rng, repeats] of [[0, 0, false], [25, 0, true], [25, 1000, false], [50, 1000, true], [100, 1000, true]] as const) {
      const state = playing();
      state.served = served;
      state.rng = rng;
      state.seats[0] = { customer: null, returnsIn: 0 };
      state.seats.slice(1).forEach(seat => { seat.customer!.type = 'tuna'; });
      state.queues.forEach(queue => queue.splice(0, queue.length, 'tuna', 'salmon', 'salmon', 'salmon', 'salmon'));
      const returned = tick(state, .05);
      expect(returned.seats[0].customer!.type).toBe(repeats ? 'tuna' : 'salmon');
      expect(tick(state, .05)).toEqual(returned);
    }
  });
  it('allows initial repeated orders and replaces simultaneous departures deterministically', () => {
    let sawRepeat = false;
    for (let seed = 0; seed < 100; seed++) {
      const initial = startGame(createGame(seed));
      const types = initial.seats.map(seat => seat.customer!.type);
      sawRepeat ||= new Set(types).size < types.length;
      initial.seats.slice(0, 2).forEach(seat => { seat.customer!.remaining = 1; });
      initial.plates = [0, 1].map((station, slot) => ({
        id: 1000 + slot, type: types[station], slot,
        position: [0.125, 0.375][station] - .001, distance: [0.125, 0.375][station] - .001,
      }));
      const departed = tick(initial, .02);
      expect(departed.served).toBe(2);
      expect(departed.seats.slice(0, 2).every(seat => seat.customer === null)).toBe(true);
      const returned = tick(departed, RULES.replacementDelay + .05);
      expect(returned.seats.every(seat => seat.customer!.quantity >= RULES.orderMin && seat.customer!.quantity <= RULES.orderMax)).toBe(true);
      expect(tick(departed, RULES.replacementDelay + .05)).toEqual(returned);
    }
    expect(sawRepeat).toBe(true);
  });
  it('falls back within the chosen category when previews lack it', () => {
    for (const [served, rng, previews, expected] of [[0, 0, 'tuna', false], [50, 1000, 'salmon', true]] as const) {
      const state = playing();
      state.rng = rng;
      state.served = served;
      state.seats[0] = { customer: null, returnsIn: 0 };
      state.seats.slice(1).forEach(seat => { seat.customer!.type = 'tuna'; });
      state.queues.forEach(queue => queue.fill(previews));
      const returned = tick(state, .05);
      expect(returned.seats[0].customer!.type === 'tuna').toBe(expected);
    }
  });
  it('moves continuously while an occupied gate waits for a free slot', () => {
    const first = launchPlate(noMatch(), 0);
    const queued = launchPlate(first, 1);
    expect(canRepeatLaunch(queued)).toBe(false);
    expect(queued.pending).toHaveLength(1);
    const waiting = tick(queued, .05);
    expect(waiting.beltPhase).toBeGreaterThan(first.beltPhase);
    expect(waiting.plates[0].slot).toBe(first.plates[0].slot);
    expect(waiting.plates[0].distance).toBeGreaterThan(first.plates[0].distance);
    const loaded = tick(waiting, .3);
    expect(loaded.pending).toHaveLength(0);
    expect(loaded.plates[0].slot).toBe(first.plates[0].slot);
    expect(new Set(loaded.plates.map(p => p.slot)).size).toBe(2);
  });
  it('reserves rapid choices in FIFO order and consumes each queue front once', () => {
    let s = noMatch();
    s.queues[1] = ['maki', 'shrimp', 'tamago', 'avocado', 'ikura'];
    s = launchPlate(s, 0);
    s = launchPlate(s, 1); s = launchPlate(s, 1); s = launchPlate(s, 2);
    expect(s.pending.map(p => [p.lane, p.type])).toEqual([[1, 'maki'], [1, 'shrimp'], [2, 'salmon']]);
    const queue = [...s.queues[1]];
    s = tick(s, 1);
    expect(s.plates.map(p => p.type)).toEqual(['salmon', 'maki', 'shrimp', 'salmon']);
    expect(new Set(s.plates.map(p => p.slot)).size).toBe(4);
    expect(s.queues[1]).toEqual(queue);
  });
  it('keeps serving and replacing customers during a backlog without shifting plates', () => {
    let s = noMatch();
    s.seats[0].customer!.type = 'salmon';
    s.seats[0].customer!.remaining = 1;
    for (let i = 0; i < 20; i++) { s.queues[0][0] = 'salmon'; s = launchPlate(s, 0); }
    const slot = s.plates[0].slot;
    s = tick(s, 1);
    expect(s.pending.length).toBeGreaterThan(0);
    expect(s.plates[0].slot).toBe(slot);
    s = tick(s, .3);
    expect(s.delivered).toBeGreaterThan(0);
    expect(s.pending.length).toBeGreaterThan(0);
    s = tick(s, 1.7);
    expect(s.seats[0].customer).not.toBeNull();
  });
  it('freezes pending insertion on pause and clears requests on restart', () => {
    const s = launchPlate(launchPlate(noMatch(), 0), 1);
    const paused = pauseGame(tick(s, .05));
    expect(tick(paused, 20)).toBe(paused);
    expect(tick(resumeGame(paused), .3).plates).toHaveLength(2);
    expect(restartGame(paused).pending).toEqual([]);
  });
  it('bounds reservations by capacity and fills unique slots before losing', () => {
    let s = noMatch();
    for (let i = 0; i < C; i++) { s.queues[0][0] = 'salmon'; s = launchPlate(s, 0); }
    expect(s.plates).toHaveLength(1);
    expect(s.pending).toHaveLength(C - 1);
    expect(canLaunch(s)).toBe(false);
    expect(launchPlate(s, 1)).toBe(s);
    s = tick(s, 11);
    expect(s.phase).toBe('lost');
    expect(s.plates).toHaveLength(C);
    expect(s.pending).toHaveLength(0);
    expect(new Set(s.plates.map(p => p.slot)).size).toBe(C);
  });
  it('continues service with a full belt when the last inserted plate matches any seat', () => {
    for (let seat = 0; seat < 4; seat++) {
      let s = noMatch();
      s.seats[seat].customer!.type = 'maki';
      s.plates = Array.from({length: C - 1}, (_, slot) => ({id: 100 + slot, type: 'salmon' as const, slot, position: slot / C, distance: slot / C}));
      s.beltPhase = 1 / C;
      s.plates.forEach(p => { p.position = (s.beltPhase + p.slot / C) % 1; p.distance = p.position; });
      s.queues[0][0] = 'maki';
      s = launchPlate(s, 0);
      expect(s.plates).toHaveLength(C);
      expect(s.phase).toBe('playing');
      expect(canLaunch(s)).toBe(false);
      s = tick(s, 10);
      expect(s.delivered).toBe(1);
      expect(canLaunch(s)).toBe(true);
    }
  });
  it('does not count an empty seat’s future replacement as a match for a full belt', () => {
    let s = noMatch();
    s.seats[0] = { customer: null, returnsIn: 1 };
    s.plates = Array.from({length: C}, (_, slot) => ({id: 100 + slot, type: 'salmon' as const, slot, position: slot / C, distance: slot / C}));
    s = tick(s, .05);
    expect(s.phase).toBe('lost');
    expect(s.seats[0].customer).toBeNull();
  });
  it('fills every spaced slot and ends when no plate matches', () => { let s = noMatch(); for (let i = 0; i < RULES.capacity; i++) { s.queues[0][0] = 'salmon'; s = launchPlate(s, 0); if (i < RULES.capacity - 1) s = tick(s, 1 / RULES.capacity / RULES.speed); } expect(s.plates).toHaveLength(RULES.capacity); expect(new Set(s.plates.map(p => p.slot)).size).toBe(RULES.capacity); expect(s.phase).toBe('lost'); expect(launchPlate(s, 0)).toBe(s); expect(tick(s, 20)).toBe(s); const positions = s.plates.map(p => p.position).sort((a,b) => a-b); for (let i = 0; i < positions.length; i++) expect((positions[(i+1)%RULES.capacity] - positions[i] + 1) % 1).toBeCloseTo(1/RULES.capacity); });
  it('feeds matching requests, frees their slot and counts completed customers only', () => { let s = noMatch(); s.seats[0].customer!.type = 'salmon'; s.seats[0].customer!.remaining = 2; s = tick(launchPlate(s, 0), 1.7); expect(s.plates).toHaveLength(0); expect(s.delivered).toBe(1); expect(s.served).toBe(0); const guest = s.seats[0].customer!; guest.remaining = 1; const id = guest.id; s = tick(launchPlate(s, 0), 14); expect(s.served).toBeGreaterThanOrEqual(1); expect(s.seats[0].customer?.id).not.toBe(id); expect(s.events.some(e => e.kind === 'complete')).toBe(true); });
  it('replaces completed customers after a gentle delay with available orders', () => { let s = noMatch(); s.seats[0].customer!.type = 'salmon'; s.seats[0].customer!.remaining = 1; s = tick(launchPlate(s, 0), 1.7); expect(s.served).toBe(1); expect(s.seats[0].customer).toBeNull(); s = tick(s, 1.7); const guest = s.seats[0].customer!; expect(guest.quantity).toBeGreaterThanOrEqual(RULES.orderMin); expect(guest.quantity).toBeLessThanOrEqual(RULES.orderMax); expect(s.queues.flat()).toContain(guest.type); });
  it('freezes ready, paused and lost states and restarts deterministically', () => { const s = pauseGame(tick(launchPlate(playing(), 0), 5)); expect(tick(s, 10)).toBe(s); expect(launchPlate(s, 1)).toBe(s); expect(tick(createGame(), 10).elapsed).toBe(0); expect(tick(resumeGame(s), 1).elapsed).toBeCloseTo(6); expect(restartGame(s)).toEqual(playing()); });
  it('preserves slot spacing through wraps over a long deterministic run', () => { const run = () => { let s = playing(); for (let i = 0; i < 2400; i++) { if (i % 15 === 0) s = launchPlate(s, i % 5); s = tick(s, .1); expect(s.plates.length).toBeLessThanOrEqual(RULES.capacity); expect(new Set(s.plates.map(p => p.slot)).size).toBe(s.plates.length); for (const plate of s.plates) { expect(plate.position).toBeGreaterThanOrEqual(0); expect(plate.position).toBeLessThan(1); expect(plate.position).toBeCloseTo((s.beltPhase + plate.slot / RULES.capacity) % 1); } } return s; }; expect(run()).toEqual(run()); });
  it('handles invalid input and equivalent large ticks', () => { const s = playing(); expect(launchPlate(s, -1)).toBe(s); expect(launchPlate(s, .5)).toBe(s); expect(tick(s, NaN)).toBe(s); expect(tick(s, -1)).toBe(s); const a = tick(s, 5); let b = s; for (let i = 0; i < 100; i++) b = tick(b, .05); expect(a.elapsed).toBeCloseTo(b.elapsed); expect(a.seats).toEqual(b.seats); });
});
