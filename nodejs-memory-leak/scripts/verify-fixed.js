// scripts/verify-fixed.js
// Same load as the leaky version. The fixed server should hold memory
// steady because the LRU evicts and the admin cache is bounded.

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3300;
const WARM_USERS = 3000;

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': data.length },
      },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve(buf)); },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve(buf));
    }).on('error', reject);
  });
}
async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try { if (await get(`http://localhost:${PORT}/health`)) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}
async function hitTrack(n) {
  const CONCURRENCY = 50;
  const tasks = [];
  for (let i = 0; i < n; i++) {
    tasks.push(post(`http://localhost:${PORT}/track`, {
      userId: `u_${i}`,
      event: { type: 'pageview', payload: { path: `/p/${i % 50}` } },
    }));
  }
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + CONCURRENCY));
  }
}

async function main() {
  console.log('[verify-fixed] spawning fixed server...');
  const child = spawn('node', ['--expose-gc', 'src/fixed-server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b.toString()));
  child.stderr.on('data', (b) => (log += b.toString()));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);

  try {
    await waitForHealth();

    console.log('[verify-fixed] warm-up: 3000 unique users');
    await hitTrack(WARM_USERS);
    for (let i = 0; i < 5; i++) await get(`http://localhost:${PORT}/admin/stats`);
    const d1 = JSON.parse(await get(`http://localhost:${PORT}/__diag`));
    console.log('[verify-fixed] after warm-up:', d1);

    console.log('[verify-fixed] more traffic (same set of users)');
    for (let i = 0; i < WARM_USERS; i++) {
      await post(`http://localhost:${PORT}/track`, {
        userId: `u_${i}`,
        event: { type: 'pageview', payload: { path: `/p/${i % 50}` } },
      });
    }
    for (let i = 0; i < 10; i++) await get(`http://localhost:${PORT}/admin/stats`);
    const d2 = JSON.parse(await get(`http://localhost:${PORT}/__diag`));
    console.log('[verify-fixed] after second load:', d2);

    // The LRU is capped at 10_000 so 3000 sessions fit easily.
    // Admin snapshots should be capped at 100.
    // RSS shouldn't grow significantly.
    const rssDelta = d2.rss_mb - d1.rss_mb;
    const adminDelta = d2.adminSnapshots - d1.adminSnapshots;
    console.log(`\n[verify-fixed] RSS delta:    ${rssDelta.toFixed(1)} MB`);
    console.log(`[verify-fixed] admin snap delta: ${adminDelta}`);

    if (adminDelta > 30) {
      console.error('\n[verify-fixed] ✗ FAIL — admin snapshots should be bounded');
      process.exit(2);
    }
    if (rssDelta > 30) {
      console.error('\n[verify-fixed] ✗ FAIL — RSS grew too much');
      process.exit(2);
    }
    console.log('\n[verify-fixed] ✓ PASS — fixed server holds memory steady under same load');
  } finally {
    cleanup();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
