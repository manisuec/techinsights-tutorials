import express, { type Request, type Response } from 'express';
import { cpus } from 'node:os';
import type { Server } from 'node:http';
import { WorkerPool } from '../pool/worker-pool.js';

const PORT = Number(process.env.PORT ?? 3000);
const POOL_SIZE = process.env.POOL_SIZE
  ? Number(process.env.POOL_SIZE)
  : Math.max(1, cpus().length - 1);

const app = express();
app.disable('x-powered-by');

const pool = new WorkerPool({
  size: POOL_SIZE,
  taskTimeoutMs: 30_000,
  maxQueueDepth: 1_000,
});

app.get('/hash', async (req: Request, res: Response) => {
  const roundsParam = Number(req.query.rounds ?? 1000);
  if (!Number.isFinite(roundsParam) || roundsParam < 1) {
    res.status(400).json({ error: 'rounds must be a positive integer' });
    return;
  }
  const rounds = Math.min(roundsParam, 100_000);

  try {
    const result = await pool.run({ payload: 'benchmark-payload', rounds });
    res.json({ ...result, pid: process.pid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Queue full and pool closing both yield 503; bad input is the caller's fault.
    const status = /queue is full|pool is (closing|disabled)/.test(message) ? 503 : 500;
    res.status(status).json({ error: message });
  }
});

app.get('/stats', (_req: Request, res: Response) => {
  res.json({ pid: process.pid, ...pool.stats });
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, pid: process.pid });
});

export async function startServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`[${process.pid}] listening on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

export async function stopServer(): Promise<void> {
  await pool.close();
}
