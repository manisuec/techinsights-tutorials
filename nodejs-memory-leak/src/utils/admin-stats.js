// src/utils/admin-stats.js
// The "admin dashboard" — caches the most recent /admin/stats response
// in another Map that also never evicts. The cache key is a timestamp,
// but we never delete old entries. This is Leak #3.

class AdminStatsCache {
  constructor() {
    this.cache = new Map();
  }

  record(snapshot) {
    // The "key" is a wall-clock string. We keep it forever.
    // Each value is a deep copy of the entire session cache.
    const key = new Date().toISOString();
    this.cache.set(key, snapshot);
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

module.exports = { AdminStatsCache };
