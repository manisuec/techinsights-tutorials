// scripts/snapshot.js
// Trigger a heap snapshot against a target PID using V8's built-in
// `v8.writeHeapSnapshot()` (Node 11.13+). Requires --expose-gc so we
// can force a major GC right before snapshotting — otherwise you'll
// see a lot of unreachable objects that aren't really a leak.
//
// Usage:
//   node scripts/snapshot.js [pid] [label]
//   PORT=3001 node scripts/snapshot.js self baseline

const v8 = require('v8');
const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.resolve(__dirname, '..', 'snapshots');
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

function take(label = 'snapshot') {
  // If the user has --expose-gc, force a major GC so the snapshot
  // reflects the *retained* set, not the *reachable* set.
  if (typeof global.gc === 'function') {
    console.log('[snapshot] forcing major GC...');
    global.gc();
  } else {
    console.warn(
      '[snapshot] WARNING: run with `node --expose-gc ...` for cleaner snapshots',
    );
  }

  const filename = path.join(
    SNAPSHOT_DIR,
    `${label}-${Date.now()}.heapsnapshot`,
  );
  v8.writeHeapSnapshot(filename);
  const size = fs.statSync(filename).size;
  console.log(`[snapshot] wrote ${filename} (${(size / 1024).toFixed(1)} KB)`);
  return filename;
}

if (require.main === module) {
  // Default: snapshot the current process.
  take(process.argv[2] || 'self');
}

module.exports = { take };
