import { createHash } from 'node:crypto';

export interface HashRequest {
  readonly payload: string;
  readonly rounds: number;
}

export interface HashResult {
  readonly digest: string;
  readonly rounds: number;
  readonly durationMs: number;
}

/**
 * Deliberately CPU-bound and synchronous. Stands in for whatever
 * your real blocking function is: image resize, PDF render,
 * regex over a large document, JSON.parse of a 20 MB body.
 */
export function iteratedHash({ payload, rounds }: HashRequest): HashResult {
  const start = performance.now();
  let current = payload;

  for (let i = 0; i < rounds; i++) {
    current = createHash('sha256').update(current).digest('hex');
  }

  return {
    digest: current,
    rounds,
    durationMs: performance.now() - start,
  };
}
