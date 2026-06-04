export type { RepoPrKey } from '#root/src/tools/repository-ref.js';
export { makeRepoPrKey } from '#root/src/tools/repository-ref.js';
import type { RepoPrKey } from '#root/src/tools/repository-ref.js';

export type FreshnessStore = {
  lastDeliveredAt(key: RepoPrKey): string | null;
  record(key: RepoPrKey, deliveredAt: string): void;
  purge(key: RepoPrKey): void;
};

export function createInMemoryFreshnessStore(): FreshnessStore {
  const map = new Map<RepoPrKey, string>();
  return {
    lastDeliveredAt(key) {
      return map.get(key) ?? null;
    },
    record(key, deliveredAt) {
      const ms = Date.parse(deliveredAt);
      if (Number.isNaN(ms)) return;
      const current = map.get(key);
      if (current === undefined || ms > Date.parse(current)) {
        map.set(key, deliveredAt);
      }
    },
    purge(key) {
      map.delete(key);
    }
  };
}
