import { describe, expect, it } from 'vitest';

import { createInMemoryFreshnessStore, makeRepoPrKey } from '#root/src/tools/freshness-store.js';

describe('createInMemoryFreshnessStore', () => {
  it('returns null before the first record', () => {
    const store = createInMemoryFreshnessStore();
    const key = makeRepoPrKey('owner', 'repo', 1);
    expect(store.lastDeliveredAt(key)).toBeNull();
  });

  it('returns the recorded timestamp after record', () => {
    const store = createInMemoryFreshnessStore();
    const key = makeRepoPrKey('owner', 'repo', 1);
    store.record(key, '2026-06-01T12:00:00.000Z');
    expect(store.lastDeliveredAt(key)).toBe('2026-06-01T12:00:00.000Z');
  });

  it('advances the watermark when a later timestamp is recorded', () => {
    const store = createInMemoryFreshnessStore();
    const key = makeRepoPrKey('owner', 'repo', 1);
    store.record(key, '2026-06-01T12:00:00.000Z');
    store.record(key, '2026-06-01T13:00:00.000Z');
    expect(store.lastDeliveredAt(key)).toBe('2026-06-01T13:00:00.000Z');
  });

  it('does not move the watermark backwards when an earlier timestamp is recorded', () => {
    const store = createInMemoryFreshnessStore();
    const key = makeRepoPrKey('owner', 'repo', 1);
    store.record(key, '2026-06-01T13:00:00.000Z');
    store.record(key, '2026-06-01T10:00:00.000Z');
    expect(store.lastDeliveredAt(key)).toBe('2026-06-01T13:00:00.000Z');
  });

  it('returns null after purge', () => {
    const store = createInMemoryFreshnessStore();
    const key = makeRepoPrKey('owner', 'repo', 1);
    store.record(key, '2026-06-01T12:00:00.000Z');
    store.purge(key);
    expect(store.lastDeliveredAt(key)).toBeNull();
  });

  it('isolates keys by owner, repo, and PR number', () => {
    const store = createInMemoryFreshnessStore();
    const key1 = makeRepoPrKey('owner', 'repo', 1);
    const key2 = makeRepoPrKey('owner', 'repo', 2);
    const key3 = makeRepoPrKey('owner', 'other', 1);

    store.record(key1, '2026-06-01T12:00:00.000Z');
    expect(store.lastDeliveredAt(key2)).toBeNull();
    expect(store.lastDeliveredAt(key3)).toBeNull();
  });

  it('purge on unknown key is a no-op', () => {
    const store = createInMemoryFreshnessStore();
    const key = makeRepoPrKey('owner', 'repo', 99);
    expect(() => store.purge(key)).not.toThrow();
    expect(store.lastDeliveredAt(key)).toBeNull();
  });
});
