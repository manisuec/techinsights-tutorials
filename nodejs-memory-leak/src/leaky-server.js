// src/leaky-server.js
// The version that ate 8GB of RAM over a long weekend.
//
// Three leaks stacked on top of each other:
//   1. SessionCache (Map) — no eviction, holds every session ever.
//   2. setInterval in stats.js — closure pins the entire cache for life.
//   3. AdminStatsCache (Map) — records a snapshot every time /admin/stats is hit.
//
// Run with --expose-gc so we can force GC during debugging.

const express = require('express');
const { SessionCache } = require('./utils/cache');
const { startMetricsLoop } = require('./utils/stats');
const { AdminStatsCache } = require('./utils/admin-stats');

const app = express();
app.use(express.json());

const sessions = new SessionCache();
const adminStats = new AdminStatsCache();

startMetricsLoop(sessions); // Leak #2 starts here, never stops.

function makeSession(userId) {
  return {
    userId,
    createdAt: Date.now(),
    events: [],
    metadata: {
      // Realistic-looking payload. ~2KB per session.
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...',
      ip: '203.0.113.42',
      referrer: 'https://google.com/search?q=cats',
      flags: { isPro: true, abGroup: 'C', cohort: '2024-Q4' },
      prefs: new Array(20).fill(0).map((_, i) => `pref_${i}`),
    },
  };
}

app.post('/track', (req, res) => {
  const { userId, event } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  let s = sessions.get(userId);
  if (!s) {
    s = makeSession(userId);
    sessions.set(userId, s);
  }
  s.events.push({
    type: event?.type || 'pageview',
    ts: Date.now(),
    payload: event?.payload || {},
  });
  res.json({ ok: true, events: s.events.length });
});

app.get('/admin/stats', (req, res) => {
  // Build a snapshot, then "cache" it forever in adminStats.
  const snapshot = {
    totalUsers: sessions.size(),
    sample: [],
  };
  let i = 0;
  for (const [, s] of sessions.sessions) {
    if (i++ >= 10) break;
    snapshot.sample.push({
      userId: s.userId,
      eventCount: s.events.length,
    });
  }
  adminStats.record(snapshot);
  res.json({ ...snapshot, snapshotHistorySize: adminStats.size() });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// GET /__diag — handy for watching memory while reproducing.
app.get('/__diag', (req, res) => {
  const m = process.memoryUsage();
  res.json({
    rss_mb: +(m.rss / 1024 / 1024).toFixed(1),
    heap_used_mb: +(m.heapUsed / 1024 / 1024).toFixed(1),
    heap_total_mb: +(m.heapTotal / 1024 / 1024).toFixed(1),
    external_mb: +(m.external / 1024 / 1024).toFixed(1),
    sessions: sessions.size(),
    adminSnapshots: adminStats.size(),
  });
});

// POST /__snapshot — writes a heap snapshot and returns the filename.
// Only enabled when ENABLE_SNAPSHOT_ENDPOINT=1 so production isn't
// accidentally exposing it.
if (process.env.ENABLE_SNAPSHOT_ENDPOINT === '1') {
  const v8 = require('v8');
  const fs = require('fs');
  const path = require('path');
  const SNAP_DIR = path.resolve(__dirname, '..', 'snapshots');
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  app.post('/__snapshot', (req, res) => {
    if (typeof global.gc === 'function') global.gc();
    const file = path.join(SNAP_DIR, `${req.query.label || 'snap'}-${Date.now()}.heapsnapshot`);
    v8.writeHeapSnapshot(file);
    res.json({ file, kb: +(fs.statSync(file).size / 1024).toFixed(1) });
  });
  console.log('[leaky] /__snapshot endpoint enabled');
}

// Note: no graceful shutdown handler. The interval keeps running
// until the OS kills the process. Classic.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[leaky] listening on ${PORT}`);
  console.log(`[leaky] try: curl localhost:${PORT}/__diag`);
});
