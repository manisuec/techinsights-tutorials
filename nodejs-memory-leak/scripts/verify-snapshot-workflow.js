// scripts/verify-snapshot-workflow.js
// The full story in one script:
//   1. Boot the leaky server with the snapshot endpoint enabled.
//   2. Warm up with traffic.
//   3. Take a baseline heap snapshot via /__snapshot.
//   4. Send more traffic.
//   5. Take a post snapshot.
//   6. Diff them with scripts/diff-snapshots.js.
//   7. Print PASS/FAIL based on whether "SessionCache" / "Map" constructors grew.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3200;
const WARM_USERS = 3000;
const SNAP_DIR = path.join(ROOT, 'snapshots');
fs.mkdirSync(SNAP_DIR, { recursive: true });

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {},
      },
      (res) => { let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve(buf)); },
    );
    req.on('error', reject);
    if (data) req.write(data);
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
  console.log('[verify-snap] spawning leaky server with /__snapshot enabled...');
  const child = spawn('node', ['--expose-gc', 'src/leaky-server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ENABLE_SNAPSHOT_ENDPOINT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b.toString()));
  child.stderr.on('data', (b) => (log += b.toString()));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);

  try {
    await waitForHealth();
    console.log('[verify-snap] server up');

    console.log('[verify-snap] warm-up: 3000 unique users');
    await hitTrack(WARM_USERS);
    for (let i = 0; i < 5; i++) await get(`http://localhost:${PORT}/admin/stats`);

    console.log('[verify-snap] taking baseline snapshot...');
    const baseline = JSON.parse(await post(`http://localhost:${PORT}/__snapshot?label=baseline`));
    console.log(`[verify-snap]   wrote ${baseline.file} (${baseline.kb} KB)`);

    console.log('[verify-snap] more traffic: 3000 more events + admin hits');
    for (let i = 0; i < WARM_USERS; i++) {
      await post(`http://localhost:${PORT}/track`, {
        userId: `u_${i}`,
        event: { type: 'pageview', payload: { path: `/p/${i % 50}` } },
      });
    }
    for (let i = 0; i < 10; i++) await get(`http://localhost:${PORT}/admin/stats`);

    console.log('[verify-snap] taking post snapshot...');
    const post_ = JSON.parse(await post(`http://localhost:${PORT}/__snapshot?label=post`));
    console.log(`[verify-snap]   wrote ${post_.file} (${post_.kb} KB)`);

    console.log('\n[verify-snap] diff:\n');
    const { execSync } = require('child_process');
    const out = execSync(
      `node ${path.join(ROOT, 'scripts', 'diff-snapshots.js')} ${baseline.file} ${post_.file}`,
      { cwd: ROOT, encoding: 'utf8' },
    );
    process.stdout.write(out);

    // The leak manifests as Objects retained past the unique-user count
    // would normally allow. Each session is an Object that holds a metadata
    // Object, an events Array, etc. — so the "Object" constructor count
    // grows in lockstep with the leak.
    const objectMatch = out.match(/Object\s+\d+\s+→\s+(\d+)\s+\+\s+(\d+)/);
    const objectDelta = objectMatch ? parseInt(objectMatch[2], 10) : 0;
    const finalDiag = JSON.parse(await get(`http://localhost:${PORT}/__diag`));
    console.log(`[verify-snap] final diag:`, finalDiag);
    console.log(`[verify-snap] Object count delta: +${objectDelta}`);

    // We added ~3000 events (1500 users × 2 events each in the second load).
    // Each event + metadata + session wrapper is at least one Object.
    if (objectDelta < 1500) {
      console.error(`\n[verify-snap] ✗ FAIL — expected Object count to grow by 1500+, got +${objectDelta}`);
      process.exit(2);
    }
    console.log('\n[verify-snap] ✓ PASS — snapshot diff surfaced the growing heap');
  } finally {
    cleanup();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
