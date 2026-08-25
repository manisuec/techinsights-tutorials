// src/utils/preview-cache.js
// When you genuinely want to cache something but DON'T want your cache
// to be the thing keeping it alive, use WeakRef.
//
// Real-world case: an LLM generates a big response object. You want to
// show a "preview" in the UI, but if the user navigates away and the
// response object becomes unreachable, you want GC to clean it up.
//
// The strong-reference Map (previewByRequest) gives O(1) lookup.
// The WeakRef lets the underlying object be collected.

class PreviewCache {
  constructor({ registry } = {}) {
    this.previewByRequest = new Map();
    // FinalizationRegistry fires when the WeakRef's target is collected.
    // We use it to evict the strong key, so the Map itself doesn't leak.
    this.registry = registry || new FinalizationRegistry((requestId) => {
      this.previewByRequest.delete(requestId);
    });
  }

  attach(requestId, previewObject) {
    this.previewByRequest.set(requestId, new WeakRef(previewObject));
    this.registry.register(previewObject, requestId);
  }

  get(requestId) {
    const ref = this.previewByRequest.get(requestId);
    if (!ref) return undefined;
    const obj = ref.deref();
    if (!obj) {
      // Already collected. Clean up the dead entry.
      this.previewByRequest.delete(requestId);
      return undefined;
    }
    return obj;
  }

  size() {
    return this.previewByRequest.size;
  }
}

module.exports = { PreviewCache };
