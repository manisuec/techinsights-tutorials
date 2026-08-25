// test/load.js
// Tiny, dependency-free load generator. Hits the leaky server with
// N unique user IDs, then watches memory.
//
// Usage:
//   node test/load.js [url] [uniqueUsers] [rounds]
//   node test/load.js http://localhost:3000 5000 3

const http = require('http');
const { performance } = require('perf_hooks');

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': data.length },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  const url = process.argv[2] || 'http://localhost:3000';
  const uniqueUsers = parseInt(process.argv[3] || '5000', 10);
  const rounds = parseInt(process.argv[4] || '3', 10);

  console.log(`[load] target=${url} users=${uniqueUsers} rounds=${rounds}`);

  const start = performance.now();
  let posted = 0;

  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    const tasks = [];
    for (let i = 0; i < uniqueUsers; i++) {
      tasks.push(
        post(`${url}/track`, {
          userId: `u_${i}`,
          event: { type: 'pageview', payload: { path: `/p/${i % 200}` } },
        }),
      );
    }
    // Chunk the concurrency a bit to avoid melting the box.
    const CONCURRENCY = 100;
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      await Promise.all(tasks.slice(i, i + CONCURRENCY));
      posted += Math.min(CONCURRENCY, tasks.length - i);
    }
    // Also hit /admin/stats a few times per round to grow the third leak.
    for (let i = 0; i < 20; i++) await get(`${url}/admin/stats`);
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    const diag = await get(`${url}/__diag`);
    console.log(`[load] round ${r + 1}/${rounds}  posted=${posted}  ${dt}s  ${diag.body}`);
  }

  console.log(`[load] done in ${((performance.now() - start) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
