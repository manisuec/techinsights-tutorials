import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import type { HashRequest, HashResult } from '../tasks/cpu-task.js';
import type { ResultEnvelope, TaskEnvelope } from './pool.worker.js';

// Always load the worker from dist/ — Worker() doesn't go through the TS
// loader, so the .ts source can't be loaded directly. The pool itself can
// be either in src/ or dist/; the relative path resolves to <root>/dist/...
// in both cases. If the file doesn't exist, the user needs to run `npm run build`.
const WORKER_URL = new URL('../../dist/pool/pool.worker.js', import.meta.url);

interface PendingTask {
  readonly envelope: TaskEnvelope;
  readonly resolve: (value: HashResult) => void;
  readonly reject: (reason: Error) => void;
  timer?: NodeJS.Timeout;
}

export interface WorkerPoolOptions {
  /** Defaults to cpus().length - 1, floored at 1. Leave a core for the event loop. */
  readonly size?: number;
  /** Reject a task if a worker hasn't answered in this long. */
  readonly taskTimeoutMs?: number;
  /** Reject new work once the queue is this deep, instead of growing forever. */
  readonly maxQueueDepth?: number;
  /** Stop auto-respawning after this many crashes in `restartWindowMs`. */
  readonly maxRestarts?: number;
  readonly restartWindowMs?: number;
}

export interface PoolStats {
  size: number;
  idle: number;
  inFlight: number;
  queued: number;
  respawns: number;
}

export class WorkerPool {
  readonly #workers: Worker[] = [];
  readonly #idle: Worker[] = [];
  readonly #queue: PendingTask[] = [];
  readonly #inFlight = new Map<number, PendingTask>();
  readonly #taskByWorker = new WeakMap<Worker, PendingTask>();

  readonly #taskTimeoutMs: number;
  readonly #maxQueueDepth: number;
  readonly #size: number;
  readonly #maxRestarts: number;
  readonly #restartWindowMs: number;

  #nextId = 0;
  #closing = false;
  #respawns = 0;
  #respawnsWindowStart = Date.now();

  constructor(options: WorkerPoolOptions = {}) {
    this.#size = options.size ?? Math.max(1, cpus().length - 1);
    this.#taskTimeoutMs = options.taskTimeoutMs ?? 30_000;
    this.#maxQueueDepth = options.maxQueueDepth ?? 1_000;
    this.#maxRestarts = options.maxRestarts ?? 5;
    this.#restartWindowMs = options.restartWindowMs ?? 60_000;

    for (let i = 0; i < this.#size; i++) this.#spawn();
  }

  #spawn(): void {
    const worker = new Worker(fileURLToPath(WORKER_URL));

    worker.on('message', (result: ResultEnvelope) => {
      const task = this.#taskByWorker.get(worker);
      this.#inFlight.delete(result.id);
      this.#taskByWorker.delete(worker);

      if (task) {
        if (task.timer) clearTimeout(task.timer);
        if (result.ok) task.resolve(result.value);
        else task.reject(new Error(result.error));
      }

      this.#idle.push(worker);
      this.#drain();
    });

    // A worker that dies takes its in-flight task with it. Fail that
    // task explicitly, then replace the worker so the pool keeps its size.
    worker.on('error', (err) => this.#retire(worker, err));
    worker.on('exit', (code) => {
      if (code !== 0 && !this.#closing) {
        this.#retire(worker, new Error(`worker exited with code ${code}`));
      }
    });

    this.#workers.push(worker);
    this.#idle.push(worker);
  }

  #retire(worker: Worker, cause: Error): void {
    const task = this.#taskByWorker.get(worker);
    if (task) {
      this.#inFlight.delete(task.envelope.id);
      this.#taskByWorker.delete(worker);
      if (task.timer) clearTimeout(task.timer);
      task.reject(cause);
    }

    const wi = this.#workers.indexOf(worker);
    if (wi !== -1) this.#workers.splice(wi, 1);
    const ii = this.#idle.indexOf(worker);
    if (ii !== -1) this.#idle.splice(ii, 1);

    void worker.terminate();

    if (this.#closing) return;

    // Backstop: don't get stuck in a hot respawn loop if spawn keeps dying.
    const now = Date.now();
    if (now - this.#respawnsWindowStart > this.#restartWindowMs) {
      this.#respawnsWindowStart = now;
      this.#respawns = 0;
    }
    this.#respawns += 1;
    if (this.#respawns > this.#maxRestarts) {
      this.#queue.splice(0).forEach((t) =>
        t.reject(new Error(`worker pool disabled: ${this.#respawns} restarts in ${this.#restartWindowMs}ms (${cause.message})`))
      );
      return;
    }

    this.#spawn();
  }

  #drain(): void {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.pop()!;
      const task = this.#queue.shift()!;

      this.#inFlight.set(task.envelope.id, task);
      this.#taskByWorker.set(worker, task);

      task.timer = setTimeout(() => {
        // If the worker is stuck, the only lever is terminate().
        // Retiring the worker also rejects the task's promise.
        this.#retire(worker, new Error(`task ${task.envelope.id} timed out`));
      }, this.#taskTimeoutMs);

      worker.postMessage(task.envelope);
    }
  }

  run(request: HashRequest): Promise<HashResult> {
    if (this.#closing) {
      return Promise.reject(new Error('pool is closing'));
    }
    if (this.#queue.length >= this.#maxQueueDepth) {
      // Backpressure. Shedding load here is far better than an OOM later.
      return Promise.reject(new Error('pool queue is full'));
    }

    return new Promise<HashResult>((resolve, reject) => {
      this.#queue.push({
        envelope: { id: this.#nextId++, request },
        resolve,
        reject,
      });
      this.#drain();
    });
  }

  get stats(): PoolStats {
    return {
      size: this.#workers.length,
      idle: this.#idle.length,
      inFlight: this.#inFlight.size,
      queued: this.#queue.length,
      respawns: this.#respawns,
    };
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const task of this.#queue) {
      task.reject(new Error('pool closed'));
    }
    this.#queue.length = 0;
    // Clear in-flight timers so they don't keep the loop alive past terminate().
    for (const task of this.#inFlight.values()) {
      if (task.timer) clearTimeout(task.timer);
    }
    await Promise.all(this.#workers.map((w) => w.terminate()));
  }
}
