// bench/throughput.mjs
// End-to-end HTTP throughput against the running server.
// This is the one you should run on real (multi-core) hardware — the
// 1-vCPU numbers in the blog post deliberately skip throughput.
//
// Usage: node bench/throughput.mjs <baseline|pool|cluster> <concurrency> <duration-s>
import autocannon from 'autocannon';

const [mode = 'baseline', concurrency = '50', duration = '20'] = process.argv.slice(2);

// mode is just a label here; the server itself decides how to handle the request.
// In the README, "baseline" means: don't use cluster, just one app process.
// "pool" means: app + worker pool inside one process.
// "cluster" means: N primary workers, each with its own pool.
const result = await autocannon({
  url: `http://localhost:${process.env.PORT ?? 3000}/hash?rounds=2000`,
  connections: Number(concurrency),
  duration: Number(duration),
});

console.table({
  mode,
  rps: result.requests.average.toFixed(0),
  p50: `${result.latency.p50} ms`,
  p99: `${result.latency.p99} ms`,
  errors: result.errors,
});
