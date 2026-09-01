// bench/spawn-cost.mjs
// Benchmark 1: time from "create" to "first message received" for
// worker_threads and child_process.fork.
//
// Usage: node bench/spawn-cost.mjs [iterations=20]
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ITERATIONS = Number(process.argv[2] ?? 20);

function percentile(arr, p) {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(name, times) {
  const min = Math.min(...times);
  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  console.log(
    `${name.padEnd(20)} min=${min.toFixed(1)}ms  p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms`
  );
  return { name, min, p50, p95 };
}

async function benchWorkerThreads() {
  // Inline source — the worker just signals it's ready, no work yet.
  const source = `
    const { parentPort } = require('node:worker_threads');
    parentPort.postMessage('ready');
  `;
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const worker = new Worker(source, { eval: true });
    await new Promise((resolve) => worker.once('message', resolve));
    times.push(performance.now() - start);
    await worker.terminate();
  }
  return times;
}

async function benchFork() {
  // fork() needs a real file path, not eval. Write a tiny script to tmp.
  const tmpFile = join(tmpdir(), `fork-spawn-bench-${process.pid}.js`);
  writeFileSync(tmpFile, `process.send('ready');\n`);
  const times = [];
  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const child = fork(tmpFile, [], { serialization: 'advanced' });
      await new Promise((resolve) => child.once('message', resolve));
      times.push(performance.now() - start);
      child.kill();
    }
  } finally {
    unlinkSync(tmpFile);
  }
  return times;
}

console.log(`\nBenchmark 1 — startup cost (${ITERATIONS} iterations each)\n`);

const wt = await benchWorkerThreads();
const fp = await benchFork();

console.log();
summarize('worker_threads', wt);
summarize('child_process.fork', fp);

console.log(
  '\nNote: both primitives cost tens of ms to start. Do not spawn per request — use a pool.\n'
);
