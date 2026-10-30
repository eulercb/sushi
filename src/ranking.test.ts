import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankEntry, RankingStorage } from './ranking';

const entry = (id: string, served = 1, delivered = served, createdAt = 1): RankEntry => ({ id, served, delivered, createdAt });
const storage = () => {
  const data = new Map<string, string>();
  return { data, getItem: vi.fn((key: string) => data.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { data.set(key, value); }) };
};

beforeEach(() => vi.resetModules());

describe('local rankings', () => {
  it('orders by customers, then deliveries, then earlier date and caps at ten', async () => {
    const { topRanking } = await import('./ranking');
    const results = topRanking([...Array.from({ length: 12 }, (_, i) => entry(String(i), i)), entry('tie', 11, 12, 2), entry('earlier', 11, 12, 1)]);
    expect(results).toHaveLength(10);
    expect(results.slice(0, 3).map(r => r.id)).toEqual(['earlier', 'tie', '11']);
  });

  it('updates a run once and reloads persisted results', async () => {
    const rank = await import('./ranking');
    const disk = storage();
    rank.recordResult(entry('run', 0), disk);
    expect(rank.recordResult(entry('run', 5), disk)).toEqual([entry('run', 5)]);
    vi.resetModules();
    expect((await import('./ranking')).readRanking(disk)).toEqual([entry('run', 5)]);
    expect(disk.getItem).toHaveBeenCalledWith('sushi-loop-ranking-v1');
  });

  it('ignores legacy points, malformed JSON and invalid entries', async () => {
    const rank = await import('./ranking');
    const disk = storage();
    disk.data.set('sushi-loop-best', '99999');
    expect(rank.readRanking(disk)).toEqual([]);
    disk.data.set(rank.RANKING_KEY, '{broken');
    expect(rank.readRanking(disk)).toEqual([]);
    disk.data.set(rank.RANKING_KEY, JSON.stringify([entry('good'), entry('negative', -1), entry('decimal', 1.2), { ...entry('string'), served: '5' }, null, {}, entry('infinite', Infinity), entry('', 2)]));
    expect(rank.readRanking(disk)).toEqual([entry('good')]);
    expect(rank.recordResult(entry('bad', NaN), disk)).toEqual([entry('good')]);
  });

  it('keeps session results when writes fail even if reads keep returning old data', async () => {
    const rank = await import('./ranking');
    const disk = storage();
    rank.recordResult(entry('old'), disk);
    disk.setItem.mockImplementation(() => { throw new Error('quota'); });
    rank.recordResult(entry('new', 3), disk);
    expect(rank.readRanking(disk).map(r => r.id)).toEqual(['new', 'old']);
    rank.recordResult(entry('new', 4), disk);
    expect(rank.readRanking(disk)).toEqual([entry('new', 4), entry('old')]);
  });

  it('survives blocked storage and supports an SSR memory fallback', async () => {
    const rank = await import('./ranking');
    const blocked: RankingStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(rank.recordResult(entry('blocked', 2), blocked)).toEqual([entry('blocked', 2)]);
    expect(rank.readRanking(blocked)).toEqual([entry('blocked', 2)]);
    expect(rank.recordResult(entry('memory', 3), null).map(r => r.id)).toEqual(['memory', 'blocked']);
    expect(rank.readRanking(null).map(r => r.id)).toEqual(['memory', 'blocked']);
    const snapshot = rank.readRanking(null);
    snapshot[0].served = 999;
    expect(rank.readRanking(null)[0].served).toBe(3);
  });
});
