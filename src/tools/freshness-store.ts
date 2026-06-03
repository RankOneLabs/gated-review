export type RepoPrKey = string & { readonly __brand: 'RepoPrKey' };

export function makeRepoPrKey(owner: string, repo: string, prNumber: number): RepoPrKey {
  return `${owner}/${repo}#${prNumber}` as RepoPrKey;
}

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
      map.set(key, deliveredAt);
    },
    purge(key) {
      map.delete(key);
    }
  };
}
