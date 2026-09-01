import { parentPort } from 'node:worker_threads';
import { iteratedHash, type HashRequest, type HashResult } from '../tasks/cpu-task.js';

if (!parentPort) {
  throw new Error('pool.worker.ts must be run as a worker thread');
}

export interface TaskEnvelope {
  readonly id: number;
  readonly request: HashRequest;
}

export type ResultEnvelope =
  | { readonly id: number; readonly ok: true; readonly value: HashResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

const port = parentPort;

port.on('message', (task: TaskEnvelope) => {
  try {
    const value = iteratedHash(task.request);
    port.postMessage({ id: task.id, ok: true, value } satisfies ResultEnvelope);
  } catch (err) {
    port.postMessage({
      id: task.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ResultEnvelope);
  }
});
