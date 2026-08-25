// src/utils/safe-stats.js
// Same metrics loop, but:
//   - returns the handle so we can clearInterval on shutdown
//   - only iterates up to N sessions to avoid O(N) work per tick
//   - doesn't capture the cache by closure — takes a getter function instead

function startMetricsLoop(getSnapshot, { intervalMs = 1000, debug = false } = {}) {
  const handle = setInterval(() => {
    const snap = getSnapshot();
    if (debug) {
      console.log(
        `[stats] users=${snap.users} events=${snap.events} ` +
        `rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB`,
      );
    }
  }, intervalMs);
  // .unref() lets the process exit even if the timer is still scheduled.
  handle.unref();
  return handle;
}

module.exports = { startMetricsLoop };
