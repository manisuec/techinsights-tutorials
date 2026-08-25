// src/utils/stats.js
// The "metrics aggregator" — runs every second via setInterval.
// It holds a closure over the entire session cache, which keeps every
// session object alive for the life of the process. This is Leak #2.
//
// Also, the interval handle is never unref()'d and never cleared on shutdown.

function startMetricsLoop(sessionCache) {
  setInterval(() => {
    let totalEvents = 0;
    let totalUsers = sessionCache.size();

    for (const [, session] of sessionCache.sessions) {
      // Pretend we're computing "events per user per second" for the dashboard.
      totalEvents += session.events.length;
    }

    if (process.env.DEBUG_STATS) {
      console.log(
        `[stats] users=${totalUsers} events=${totalEvents} ` +
        `rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}MB`,
      );
    }
  }, 1000);
}

module.exports = { startMetricsLoop };
