// bench/ipc-latency.mjs
// Benchmarks 3, 4, and 5 from the post:
//   3. small-message round-trip latency
//   4. 16 MB transfer (structured clone vs transferable vs JSON IPC)
//   5. fork()'s `serialization: 'json'` vs `'advanced'` for a 4 MB Buffer
//
// Usage: node bench/ipc-latency.mjs
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function percentile(arr, p) {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ----- Benchmark 3: small message round-trip latency -----
async function benchSmallMessage() {
  const ITERATIONS = 2000;
  const WARMUP = 100;

  // worker_threads: postMessage echoes the message back.
  const wt = new Worker(
    `const { parentPort } = require('node:worker_threads');
     parentPort.on('message', (m) => parentPort.postMessage(m));`,
    { eval: true }
  );

  const wtTimes = [];
  for (let i = 0; i < WARMUP; i++) {
    await new Promise((r) => {
      wt.once('message', r);
      wt.postMessage({ i });
    });
  }
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((r) => {
      wt.once('message', r);
      wt.postMessage({ i });
    });
    wtTimes.push(performance.now() - start);
  }
  await wt.terminate();

  // child_process: same shape, but over a real pipe.
  const tmpFile = join(tmpdir(), `ipc-latency-${process.pid}.js`);
  writeFileSync(tmpFile, `process.on('message', (m) => process.send(m));`);

  const fp = fork(tmpFile, [], { serialization: 'advanced' });
  const fpTimes = [];
  for (let i = 0; i < WARMUP; i++) {
    await new Promise((r) => {
      fp.once('message', r);
      fp.send({ i });
    });
  }
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((r) => {
      fp.once('message', r);
      fp.send({ i });
    });
    fpTimes.push(performance.now() - start);
  }
  fp.kill();
  unlinkSync(tmpFile);

  return { wtTimes, fpTimes };
}

// ----- Benchmark 4: 16 MB transfer -----
async function benchLargeTransfer() {
  const SIZE = 16 * 1024 * 1024;

  // worker_threads: echo an ArrayBuffer back.
  const wt = new Worker(
    `const { parentPort } = require('node:worker_threads');
     parentPort.on('message', (buf) => parentPort.postMessage(buf, [buf]));`,
    { eval: true }
  );

  // structured clone (copy)
  const bufCopy = new ArrayBuffer(SIZE);
  const tCopy = performance.now();
  await new Promise((r) => {
    wt.once('message', r);
    wt.postMessage(bufCopy);
  });
  const copyTime = performance.now() - tCopy;

  // transferable
  const bufXfer = new ArrayBuffer(SIZE);
  const tXfer = performance.now();
  await new Promise((r) => {
    wt.once('message', r);
    wt.postMessage(bufXfer, [bufXfer]);
  });
  const transferTime = performance.now() - tXfer;
  const detached = bufXfer.byteLength === 0;

  await wt.terminate();

  // child_process: send a 16 MB Buffer over the default (json) IPC.
  const tmpFile = join(tmpdir(), `ipc-large-${process.pid}.js`);
  writeFileSync(tmpFile, `process.on('message', (m) => process.send(m));`);
  const fp = fork(tmpFile);
  const buf3 = Buffer.alloc(SIZE, 7);
  const tJson = performance.now();
  await new Promise((r) => {
    fp.once('message', r);
    fp.send({ buf: buf3 });
  });
  const jsonTime = performance.now() - tJson;
  fp.kill();
  unlinkSync(tmpFile);

  return { copyTime, transferTime, jsonTime, detached };
}

// ----- Benchmark 5: serialization flag on fork() -----
async function benchSerializationFlag() {
  const SIZE = 4 * 1024 * 1024;
  const ITERS = 50;
  const WARMUP = 5;

  const tmpFile = join(tmpdir(), `ipc-ser-${process.pid}.js`);
  writeFileSync(tmpFile, `process.on('message', (m) => process.send(m));`);

  async function runOne(useAdvanced) {
    const child = fork(tmpFile, [], {
      serialization: useAdvanced ? 'advanced' : 'json',
    });

    for (let i = 0; i < WARMUP; i++) {
      await new Promise((r) => {
        child.once('message', r);
        child.send({ buf: Buffer.alloc(SIZE, 7) });
      });
    }

    const times = [];
    for (let i = 0; i < ITERS; i++) {
      const start = performance.now();
      await new Promise((r) => {
        child.once('message', r);
        child.send({ buf: Buffer.alloc(SIZE, 7) });
      });
      times.push(performance.now() - start);
    }

    child.kill();
    return times;
  }

  let jsonTimes, advTimes;
  try {
    jsonTimes = await runOne(false);
    advTimes = await runOne(true);
  } finally {
    unlinkSync(tmpFile);
  }

  return { jsonTimes, advTimes };
}

console.log('\nBenchmark 3 — small-message round-trip latency (2000 round trips)\n');
{
  const { wtTimes, fpTimes } = await benchSmallMessage();
  console.log(
    `worker_threads    p50=${percentile(wtTimes, 50).toFixed(3)} ms   p99=${percentile(wtTimes, 99).toFixed(3)} ms`
  );
  console.log(
    `child_process     p50=${percentile(fpTimes, 50).toFixed(3)} ms   p99=${percentile(fpTimes, 99).toFixed(3)} ms`
  );
}

console.log('\nBenchmark 4 — 16 MB transfer\n');
{
  const r = await benchLargeTransfer();
  console.log(`worker postMessage (copy)         : ${r.copyTime.toFixed(2)} ms`);
  console.log(`worker postMessage (transferable) : ${r.transferTime.toFixed(2)} ms   (sender detached: ${r.detached})`);
  console.log(`child.send       (JSON IPC)       : ${r.jsonTime.toFixed(2)} ms`);
}

console.log("\nBenchmark 5 — fork() serialization flag (4 MB Buffer, 50 iterations)\n");
{
  const { jsonTimes, advTimes } = await benchSerializationFlag();
  const jsonP50 = percentile(jsonTimes, 50);
  const advP50 = percentile(advTimes, 50);
  console.log(`'json'      p50: ${jsonP50.toFixed(2)} ms`);
  console.log(`'advanced'  p50: ${advP50.toFixed(2)} ms`);
  console.log(`speedup:    ${(jsonP50 / advP50).toFixed(1)}×`);
}

console.log(
  '\nTwo things the 73× headline does not tell you:\n' +
    '  1. process.send()\'s serialization is synchronous on the sender\'s event loop.\n' +
    '     Sending 100 MB through fork IPC freezes your web server for the stringify.\n' +
    '  2. The 32 kB IPC rule of thumb: keep messages small. Have workers fetch\n' +
    '     large inputs themselves, and write large outputs to disk or a socket.\n'
);
