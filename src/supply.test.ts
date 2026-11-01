import { describe, expect, it } from 'vitest';
import { createGame, startGame, launchPlate, tick, RULES, type GameState, type SushiType } from './engine';

function wanted(s: GameState): Set<SushiType> {
  return new Set(s.seats.flatMap(({ customer }) => customer ? [customer.type] : []));
}
function route(s: GameState): { lane: number; depth: number } | undefined {
  const types = wanted(s);
  const free = RULES.capacity - s.plates.length - s.pending.length;
  for (let depth = 0; depth < Math.min(3, free); depth++) {
    const lane = s.queues.findIndex(queue => types.has(queue[depth]));
    if (lane >= 0) return { lane, depth };
  }
}
function junkPlate(slot: number) {
  return { id: 1000 + slot, type: 'salmon' as const, slot, position: slot / RULES.capacity, distance: slot / RULES.capacity };
}

describe('supply planning', () => {
  it('repairs at most one deeper preview when a new order has no reachable route', () => {
    let s = startGame(createGame(19));
    s.seats.forEach(seat => { seat.customer!.type = 'tuna'; });
    s.seats[0] = { customer: null, returnsIn: 0 };
    s.served = 50; s.rng = 1000;
    s.queues.forEach(queue => queue.fill('salmon'));
    s.plates = Array.from({ length: 38 }, (_, i) => junkPlate(i));
    const before = structuredClone(s.queues);
    s = tick(s, .01);
    expect(s.queues.map(queue => queue[0])).toEqual(before.map(queue => queue[0]));
    expect(s.queues.flat().filter((type, i) => type !== before.flat()[i])).toHaveLength(1);
    expect(route(s)?.depth).toBe(1);
  });

  it('keeps fronts unchanged when only one free space cannot reach a repair', () => {
    let s = startGame(createGame(19));
    s.seats.forEach(seat => { seat.customer!.type = 'tuna'; });
    s.seats[0] = { customer: null, returnsIn: 0 };
    s.served = 50; s.rng = 1000;
    s.queues.forEach(queue => queue.fill('salmon'));
    s.plates = Array.from({ length: 39 }, (_, i) => junkPlate(i));
    const before = structuredClone(s.queues);
    s = tick(s, .01);
    expect(s.queues).toEqual(before);
  });

  it('counts shared orders and travelling or pending matches without changing previews', () => {
    for (const pending of [false, true]) {
      let s = startGame(createGame(19));
      s.seats.forEach(seat => { seat.customer!.type = 'tuna'; seat.customer!.remaining = 1; });
      s.seats[0] = { customer: null, returnsIn: 0 };
      s.queues.forEach(queue => queue.fill('salmon'));
      if (pending) s.pending = [{ lane: 0, type: 'tuna' }];
      else s.plates = [{ ...junkPlate(0), type: 'tuna' }];
      const before = structuredClone(s.queues);
      s = tick(s, .01);
      expect(s.queues).toEqual(before);
    }
  });

  it('keeps attentive seeded play viable through crowded belts and repeated arrivals', () => {
    let crowdedRuns = 0;
    for (let seed = 0; seed < 40; seed++) {
      let s = startGame(createGame(seed));
      // Accumulate unmatched plates first, then follow the shortest visible path.
      for (let turn = 0; turn < 480 && s.served < 55; turn++) {
        const types = wanted(s);
        const travelling = [...s.plates, ...s.pending].some(plate => types.has(plate.type));
        if (!travelling && s.seats.some(seat => seat.customer)) {
          const junk = s.served === 0 && s.plates.length < 20 ? s.queues.findIndex(queue => !types.has(queue[0])) : -1;
          const choice = junk >= 0 ? junk : route(s)?.lane;
          expect(choice, `seed ${seed}, turn ${turn}, free ${RULES.capacity - s.plates.length}`).toBeDefined();
          s = launchPlate(s, choice!);
        }
        s = tick(s, 10);
        expect(s.phase, `seed ${seed}, turn ${turn}`).toBe('playing');
        if (s.plates.length >= 20) crowdedRuns++;
      }
      expect(s.served, `seed ${seed}`).toBeGreaterThanOrEqual(55);
    }
    expect(crowdedRuns).toBeGreaterThan(80);
  }, 30000);
});
