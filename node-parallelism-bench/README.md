# node-parallelism-bench

Companion code for the blog post [_Worker Threads vs Cluster vs Child Process: A Benchmark and a Decision Table_](#).

This repo benchmarks the three Node.js parallelism primitives — `worker_threads`, `cluster`, and `child_process` — and contains the production-ready patterns referenced in the post.

## What's in here

```
node-parallelism-bench/
├── package.json
├── tsconfig.json
├── src/
│   ├── pool/
│   │   ├── worker-pool.ts        # reusable worker_threads pool (typed, backpressured, fault-tolerant)
│   │   └── pool.worker.ts        # worker entry: unwraps task, calls pure function, wraps result
│   ├── tasks/
│   │   └── cpu-task.ts           # the CPU-bound work under test (deliberately synchronous)
│   └── server/
│       ├── cluster.ts            # cluster primary with graceful SIGTERM → SIGKILL escalation
│       └── app.ts                # the Express app: /hash, /stats, /healthz
└── bench/
    ├── spawn-cost.mjs            # Benchmark 1: startup time
    ├── mem-cost.mjs              # Benchmark 2: RSS per idle instance
    ├── ipc-latency.mjs           # Benchmarks 3, 4, 5: small messages, large transfers, serialization flag
    └── throughput.mjs            # autocannon-based HTTP throughput (run on real hardware)
```

## Quick start

```bash
nvm use            # or: nvm install (uses .nvmrc — Node 22)
npm install
npm start          # builds via `prestart`, then runs the cluster primary + N workers
```

`npm start` runs the `prestart` build script automatically, so you don't need a separate `tsc` step. The first run takes a couple of seconds; subsequent ones are sub-second (just typecheck + emit).

In another terminal:

```bash
curl 'http://localhost:3000/hash?rounds=2000'
curl 'http://localhost:3000/stats'
curl 'http://localhost:3000/healthz'
```

## Running the benchmarks

The first three bench scripts run on a single box — no multi-core needed. They measure costs that are real regardless of core count: startup, memory, and message passing.

```bash
npm run bench:spawn      # startup cost
npm run bench:mem        # RSS per instance
npm run bench:ipc        # IPC latency, large transfers, serialization flag
npm run bench            # all of the above
```

`bench/throughput.mjs` is the one you run against the actual server, on real hardware. Start the server in one terminal, then:

```bash
# baseline: one app process, no cluster
POOL_SIZE=0 npm run start:no-cluster

# pool: one app process with the worker pool (default)
npm run start:no-cluster

# cluster: N primary workers, each with its own pool
WEB_CONCURRENCY=4 npm start
```

Then in another terminal:

```bash
node bench/throughput.mjs baseline 50 20
node bench/throughput.mjs pool 50 20
node bench/throughput.mjs cluster 50 20
```

**What you should see on a multi-core box:**

- **Baseline:** throughput is flat as you add connections. Latency scales linearly with concurrency — the queue in front of your single loop.
- **Pool:** p99 collapses dramatically (the loop is free to accept and respond). Throughput improves up to roughly `cores - 1`, then flattens.
- **Cluster:** throughput scales close to linearly with cores until you hit a shared bottleneck (usually your DB connection pool, sometimes the NIC). Latency for a single slow request doesn't improve — each request is still blocking one loop.

## Hardware caveat

The numbers in the blog post were collected on a 1-vCPU box. That deliberately excludes throughput scaling — on one core, four workers are four workers fighting over one core, and any speedup number would be a lie. `bench/throughput.mjs` is the harness for that. Run it on your target hardware and compare to the "what to look for" expectations above.

## Configuration

All knobs are environment variables — no rebuilds needed.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3000` | HTTP port the app listens on |
| `WEB_CONCURRENCY` | `availableParallelism()` | Number of cluster workers (cluster mode only) |
| `POOL_SIZE` | `cpus().length - 1` | Worker threads in the pool (single-process mode) |

In containers, `cpus().length` reports **host** cores, not your CFS quota. A pod limited to 500m on a 64-core node will happily spawn 63 workers. Use `os.availableParallelism()` (Node 18.14+) or read `/sys/fs/cgroup/cpu.max` directly — the cluster code does the former automatically.

## How the build is wired

The `Worker()` constructor loads a file path as raw JavaScript — it doesn't go through the TypeScript loader. So the pool always loads its worker from `dist/pool/pool.worker.js` (a relative path that resolves to `<root>/dist/...` regardless of whether the pool itself is running from `src/` or `dist/`). That means you must build before you run the server. `npm start` does this via the `prestart` hook.

The bench scripts don't need the build — they test the primitives directly with inline source, no imports from `src/`.

## License

MIT — see [LICENSE](./LICENSE).
