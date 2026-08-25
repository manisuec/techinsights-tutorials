// src/utils/cache.js
// The "session cache" — a Map that pretends to be temporary storage.
// It is, in fact, a forever-storage device. This is Leak #1 of 3.

class SessionCache {
  constructor() {
    // Strong references, no TTL, no LRU, no eviction. Just a Map.
    this.sessions = new Map();
  }

  get(sid) {
    return this.sessions.get(sid);
  }

  set(sid, data) {
    this.sessions.set(sid, data);
  }

  size() {
    return this.sessions.size;
  }
}

module.exports = { SessionCache };
