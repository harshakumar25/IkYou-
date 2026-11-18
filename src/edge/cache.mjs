/**
 * Edge In-Memory LRU & Tiered Cache
 * Delivers sub-2ms cached profile responses with stale-while-revalidate capability.
 */

class EdgeLRUCache {
  constructor(maxEntries = 1000, defaultTtlMs = 600000) { // 10 minutes default TTL
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  _normalizeKey(key) {
    return String(key).toLowerCase().trim();
  }

  get(key) {
    const k = this._normalizeKey(key);
    const entry = this.cache.get(k);
    if (!entry) return null;

    const now = Date.now();
    // Check if expired
    if (now > entry.expiresAt) {
      this.cache.delete(k);
      return null;
    }

    // Refresh LRU position
    this.cache.delete(k);
    this.cache.set(k, entry);

    return {
      data: entry.data,
      isStale: now > entry.staleAt,
      ageMs: now - entry.createdAt
    };
  }

  set(key, data, ttlMs = this.defaultTtlMs) {
    const k = this._normalizeKey(key);
    const now = Date.now();

    // Evict oldest if full
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(k, {
      data,
      createdAt: now,
      staleAt: now + (ttlMs * 0.7), // Mark stale at 70% of TTL for revalidation
      expiresAt: now + ttlMs
    });
  }

  has(key) {
    const k = this._normalizeKey(key);
    const entry = this.cache.get(k);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(k);
      return false;
    }
    return true;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

export const globalEdgeCache = new EdgeLRUCache(2000, 600000);
