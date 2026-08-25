// src/utils/safe-cache.js
// Bounded LRU. When full, evicts the least-recently-used entry.
// No external deps. Map iteration order = insertion order, which is
// what we lean on for LRU semantics.

class SafeSessionCache {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.sessions = new Map();
  }

  get(sid) {
    if (!this.sessions.has(sid)) return undefined;
    const value = this.sessions.get(sid);
    // Refresh recency: delete + re-set puts it at the back of the Map.
    this.sessions.delete(sid);
    this.sessions.set(sid, value);
    return value;
  }

  set(sid, data) {
    if (this.sessions.has(sid)) {
      this.sessions.delete(sid);
    } else if (this.sessions.size >= this.maxEntries) {
      // Evict the oldest entry. Map iterates in insertion order,
      // so the first key is the LRU.
      const oldest = this.sessions.keys().next().value;
      this.sessions.delete(oldest);
    }
    this.sessions.set(sid, data);
  }

  size() {
    return this.sessions.size;
  }

  clear() {
    this.sessions.clear();
  }
}

module.exports = { SafeSessionCache };
