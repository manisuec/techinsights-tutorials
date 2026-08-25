// src/utils/safe-admin-stats.js
// Bounded ring buffer. Keeps the most recent N snapshots.

class SafeAdminStatsCache {
  constructor({ maxEntries = 100 } = {}) {
    this.maxEntries = maxEntries;
    this.cache = new Map();
  }

  record(snapshot) {
    const key = new Date().toISOString();
    this.cache.set(key, snapshot);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  latest() {
    let last = null;
    for (const [k, v] of this.cache) last = [k, v];
    return last;
  }

  size() {
    return this.cache.size;
  }
}

module.exports = { SafeAdminStatsCache };
