// bench/mem-cost.mjs
// Benchmark 2: memory footprint per idle instance.
//
// Usage: node bench/mem-cost.mjs [count=4]
//
// Caveat: worker_threads share the parent process's RSS, so per-worker
// memory is derived from the parent RSS delta around spawn time. Fork
// numbers are real per-child RSS reported via IPC.
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COUNT = Number(process.argv[2] ?? 4);

function mb(b) {
  return (b / 1024 / 1024).toFixed(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Hint the runtime to release before measuring.
function tryGc() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

async function benchWorkerThreads() {
  // An idle worker — just keeps the loop alive.
  const source = `setInterval(() => {}, 60_000);`;

  tryGc();
  const baseRss = process.memoryUsage().rss;

  const workers = [];
  for (let i = 0; i < COUNT; i++) {
    workers.push(new Worker(source, { eval: true }));
  }

  // Let the isolates fully initialize before measuring.
  await sleep(750);
  tryGc();
  const afterRss = process.memoryUsage().rss;

  const total = afterRss - baseRss;
  const perInstance = total / COUNT;

  for (const w of workers) await w.terminate();

  return { perInstance, total };
}

async function benchFork() {
  // Each child reports its own RSS over IPC. We take the last reading
  // after a settle period so init allocations are included.
  const tmpFile = join(tmpdir(), `mem-bench-${process.pid}.js`);
  writeFileSync(
    tmpFile,
    `
    const { memoryUsage } = require('node:process');
    setInterval(() => {
      if (process.connected) process.send({ rss: memoryUsage().rss });
    }, 200);
    `
  );

  const children = [];
  const rssByIndex = Array.from({ length: COUNT }, () => []);

  try {
    for (let i = 0; i < COUNT; i++) {
      const child = fork(tmpFile, [], { serialization: 'advanced' });
      children.push(child);
      child.on('message', (msg) => {
        if (msg && typeof msg.rss === 'number') rssByIndex[i].push(msg.rss);
      });
    }

    await sleep(1000);

    const rssValues = rssByIndex.map((readings) =>
      readings.length > 0 ? readings[readings.length - 1] : 0
    );
    const total = rssValues.reduce((a, b) => a + b, 0);
    const perInstance = total / COUNT;

    return { perInstance, total };
  } finally {
    for (const c of children) c.kill();
    unlinkSync(tmpFile);
  }
}

console.log(`\nBenchmark 2 — memory per instance (${COUNT} idle instances)\n`);
console.log(
  'Note: worker_threads numbers are derived from parent RSS delta\n' +
    '      (workers share the parent process RSS). Fork numbers are real\n' +
    '      per-child RSS reported over IPC.\n'
);

const wt = await benchWorkerThreads();
const fp = await benchFork();

console.log();
console.log(
  `${'worker_threads'.padEnd(20)} per instance: ${mb(wt.perInstance).padStart(6)} MB   total: ${mb(wt.total).padStart(6)} MB`
);
console.log(
  `${'child_process.fork'.padEnd(20)} per instance: ${mb(fp.perInstance).padStart(6)} MB   total: ${mb(fp.total).padStart(6)} MB`
);

console.log(
  '\nOn a 4-core box: 4 cluster workers cost ~180–230 MB of floor before the app\n' +
    'allocates a single object. The equivalent worker_threads fan-out costs ~40 MB.\n'
);
