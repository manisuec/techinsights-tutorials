// src/fixed-server.js
// The same surface area as leaky-server.js, but with:
//   - bounded LRU session cache
//   - cleared metrics interval on shutdown
//   - bounded admin snapshot ring buffer
//   - proper SIGTERM/SIGINT handlers
//
// Plus a bonus /preview/* pair to demonstrate WeakRef + FinalizationRegistry.

const express = require('express');
const { SafeSessionCache } = require('./utils/safe-cache');
const { startMetricsLoop } = require('./utils/safe-stats');
const { SafeAdminStatsCache } = require('./utils/safe-admin-stats');
const { PreviewCache } = require('./utils/preview-cache');

const app = express();
app.use(express.json());

const SESSION_LIMIT = 10_000;
const STATS_LIMIT = 100;

const sessions = new SafeSessionCache({ maxEntries: SESSION_LIMIT });
const adminStats = new SafeAdminStatsCache({ maxEntries: STATS_LIMIT });
const previews = new PreviewCache();

let metricsHandle = null;

function makeSession(userId) {
  return {
    userId,
    createdAt: Date.now(),
    events: [],
    metadata: {
      ua: 'Mozilla/5.0 ...',
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
  const snapshot = {
    totalUsers: sessions.size(),
    sample: [],
  };
  // We don't have a Map iterator exposed on the safe cache; we only
  // know its size. That's fine for the dashboard.
  adminStats.record(snapshot);
  res.json({ ...snapshot, snapshotHistorySize: adminStats.size() });
});

// --- WeakRef preview demo --------------------------------------------------

app.post('/preview', (req, res) => {
  const { requestId, body } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId required' });
  // Big object that we want to be GC-able later.
  const big = {
    requestId,
    text: (body?.text || '').repeat(500),
    createdAt: Date.now(),
  };
  previews.attach(requestId, big);
  res.json({ ok: true, size: previews.size() });
});

app.get('/preview/:requestId', (req, res) => {
  const found = previews.get(req.params.requestId);
  if (!found) return res.status(404).json({ error: 'not found or collected' });
  res.json({ requestId: found.requestId, length: found.text.length });
});

// --- diagnostics -----------------------------------------------------------

app.get('/__diag', (req, res) => {
  const m = process.memoryUsage();
  res.json({
    rss_mb: +(m.rss / 1024 / 1024).toFixed(1),
    heap_used_mb: +(m.heapUsed / 1024 / 1024).toFixed(1),
    heap_total_mb: +(m.heapTotal / 1024 / 1024).toFixed(1),
    external_mb: +(m.external / 1024 / 1024).toFixed(1),
    sessions: sessions.size(),
    adminSnapshots: adminStats.size(),
    previews: previews.size(),
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// --- shutdown --------------------------------------------------------------

function shutdown(signal) {
  console.log(`[fixed] received ${signal}, shutting down`);
  if (metricsHandle) clearInterval(metricsHandle);
  sessions.clear();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  metricsHandle = startMetricsLoop(
    () => ({ users: sessions.size() }),
    { intervalMs: 1000, debug: !!process.env.DEBUG_STATS },
  );
  console.log(`[fixed] listening on ${PORT}`);
});
