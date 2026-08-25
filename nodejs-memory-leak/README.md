# nodejs-memory-leak-hunt

> A deliberately leaky Node.js service + the heap-snapshot workflow that diagnosed it.
> Companion repo to the Medium post **"I Chased a Node.js Memory Leak for Three Days"**.

This repo exists so you can reproduce the leak on your own laptop, walk through
the exact diagnostic steps I used, and confirm the fix actually holds memory
flat under the same load.

## What's in here

```
src/
├── leaky-server.js          # the broken app (three leaks stacked)
├── fixed-server.js          # the same surface area, fixed
└── utils/
    ├── cache.js             # Leak #1: unbounded Map "session cache"
    ├── stats.js             # Leak #2: setInterval with closure over cache
    ├── admin-stats.js       # Leak #3: unbounded admin snapshot cache
    ├── safe-cache.js        # LRU with eviction
    ├── safe-stats.js        # returns the handle, unref'd, no closure
    ├── safe-admin-stats.js  # bounded ring buffer
    └── preview-cache.js     # WeakRef + FinalizationRegistry demo

scripts/
├── snapshot.js              # take a heap snapshot from inside a Node process
├── diff-snapshots.js        # coarse diff between two .heapsnapshot files
├── reproduce-leak.sh        # one-shot: boot → load → snapshot → diff
├── verify-leak.js           # CI-style: assert the leak is real
├── verify-snapshot-workflow.js  # CI-style: assert the diff catches it
├── verify-fixed.js          # CI-style: assert the fix holds
└── verify-weakref.js        # CI-style: assert WeakRef + FinalizationRegistry work

test/
└── load.js                  # dependency-free load generator

docs/
├── blog-post.md             # the Medium post, in markdown
└── walkthrough.md           # the same content, lighter formatting
```

## Quick start

```bash
# 1. install
npm install

# 2. reproduce the leak end-to-end
npm run reproduce

# This will:
#   - boot the leaky server on :3000
#   - warm it up
#   - take a baseline snapshot
#   - hit it with more traffic
#   - take a post snapshot
#   - diff them and print the top growing constructors
#   - leave the server running so you can poke at it
#
# Open Chrome DevTools → Memory → Load, then load:
#   snapshots/leaky-baseline-*.heapsnapshot
#   snapshots/leaky-post-*.heapsnapshot
# to investigate interactively.

# 3. compare with the fix
PORT=3001 npm run start:fixed
# in another terminal:
node test/load.js http://localhost:3001 5000 3
# RSS stays flat. Sessions capped at 10,000 by the LRU.
```

## Running the verifications

Each `verify-*.js` script boots its own server, exercises it, and asserts
that the expected behavior holds. They double as the test suite for the
repo, and as the proof that the diagnostic story is real.

```bash
# the leak is real
node --expose-gc scripts/verify-leak.js

# the snapshot diff actually surfaces it
node scripts/verify-snapshot-workflow.js

# the fix holds memory flat under the same load
node --expose-gc scripts/verify-fixed.js

# WeakRef + FinalizationRegistry actually collect
node --expose-gc scripts/verify-weakref.js
```

## The leaks, in one breath

| # | What | Where | Why it leaks |
|---|------|-------|--------------|
| 1 | `Map<userId, Session>` | `src/utils/cache.js` | Never evicts; every new user adds an entry forever |
| 2 | `setInterval(1s)` | `src/utils/stats.js` | The interval holds a closure over the cache → pins every session for life |
| 3 | `Map<isoTimestamp, snapshot>` | `src/utils/admin-stats.js` | Records a snapshot on every `/admin/stats` hit, never deletes |

And a common cousin the **fixed** server shows but the leaky one omits:

| # | What | Where | The right tool |
|---|------|-------|----------------|
| 4 | `Map<requestId, WeakRef<big>>` | `src/utils/preview-cache.js` | `WeakRef` so the cache doesn't keep the value alive; `FinalizationRegistry` so the key gets evicted when the value dies |

## How to read a heap snapshot

Two ways:

### CLI diff (fast, 20 seconds)

```bash
node scripts/diff-snapshots.js before.heapsnapshot after.heapsnapshot
```

This parses both files and prints the top 20 constructors by **instance count
delta**. The biggest "growing" constructors are your suspects.

### DevTools (slow, thorough)

1. Open Chrome (not Node, not VS Code).
2. DevTools → Memory → Load heap snapshot.
3. Load the first snapshot.
4. Click the dropdown at the top → "Comparison" view → load the second.
5. Sort by **Size Delta** or **Count Delta**.
6. Click a growing constructor. The bottom pane shows the **retainers** —
   the chain of references keeping these objects alive.
7. Walk the retainer tree up to the root, and you'll find the `Map` /
   closure / event listener that's the real culprit.

The retainers pane is the answer. Everything else is just clues.

## License

MIT
