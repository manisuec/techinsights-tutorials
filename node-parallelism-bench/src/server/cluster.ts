import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const WORKER_COUNT = Number(process.env.WEB_CONCURRENCY) || availableParallelism();
const SHUTDOWN_GRACE_MS = 15_000;

if (cluster.isPrimary) {
  // cluster.fork() with no args relies on the parent's module path,
  // which under ESM can resolve to undefined. Tell the primary explicitly
  // which file the workers should re-execute.
  cluster.setupPrimary({ exec: fileURLToPath(import.meta.url) });

  console.log(`primary ${process.pid} starting ${WORKER_COUNT} workers`);

  for (let i = 0; i < WORKER_COUNT; i++) cluster.fork();

  // Restart crashed workers — but not during an intentional shutdown,
  // or you'll fork replacements forever while trying to exit.
  let shuttingDown = false;

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(`worker ${worker.process.pid} died (${signal || code}); restarting`);
    cluster.fork();
  });

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`primary ${process.pid} received shutdown signal`);

    for (const id of Object.keys(cluster.workers ?? {})) {
      cluster.workers?.[id]?.send('shutdown');
    }

    // Escalate: SIGTERM at half the grace period, SIGKILL at the full grace.
    // Workers that can drain quickly exit on the polite request; only the
    // truly stuck ones get the hammer.
    setTimeout(() => {
      for (const id of Object.keys(cluster.workers ?? {})) {
        cluster.workers?.[id]?.kill('SIGTERM');
      }
    }, SHUTDOWN_GRACE_MS / 2).unref();

    setTimeout(() => {
      for (const id of Object.keys(cluster.workers ?? {})) {
        cluster.workers?.[id]?.kill('SIGKILL');
      }
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  const { startServer } = await import('./app.js');
  await startServer();

  process.on('message', (msg: unknown) => {
    if (msg !== 'shutdown') return;
    // The primary SIGTERMs the process if we ignore this; server.close()
    // lets in-flight requests finish before we exit.
    process.exit(0);
  });
}
