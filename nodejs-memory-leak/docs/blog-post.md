# I Chased a Node.js Memory Leak for Three Days. Here's the Heap Snapshot Workflow That Found It.

*Three days, three different "fixes," one leak that refused to die. This is the story — and the workflow that finally put a name on it.*

> **TL;DR.** Run with `--expose-gc`. Take a baseline snapshot, exercise the app, take a second snapshot, diff them. The constructor that's growing the most — *plus* the path of **retainers** in Chrome DevTools — is your leak. Fix it by bounding the cache, clearing the interval on shutdown, and reaching for `WeakRef` only when you really need non-owning storage.

The companion repo for this post is [github.com/sana/nodejs-memory-leak-hunt](https://github.com/sana/nodejs-memory-leak-hunt). It contains a deliberately leaky service, a fixed version, the snapshot tooling, and the four verification scripts that prove every claim in this post.

---

## Day 0 — Friday, 6:42 PM

PagerDuty: `production-api-prod-7` is at 91% memory.

I SSH in. The dashboard is honest about it: RSS is climbing at ~80 MB/hour, has been for nine hours, and shows no sign of stopping. CPU is fine. Latency is fine. Only memory is wrong, in the way a dripping faucet is wrong — not a flood, but you'll wake up to a flood.

The first instinct, like everyone else's, is to restart the pod and buy the on-call engineer (me) a night. I do that. The pod comes back at 240 MB. By midnight it's at 800 MB.

The leak is real, it's in our code, and it doesn't care about restarts.

This post is the workflow I wish I'd had on Day 0. It's the workflow I'm going to use the next time.

---

## Day 1 — "It's the cache"

The first thing anyone suspects is a cache, and ours is a doozy. We have an in-memory "session view history" feature that stores the last N events per user. The code looks like this:

```js
// src/utils/cache.js
class SessionCache {
  constructor() {
    // Strong references. No TTL. No LRU. No eviction. Just a Map.
    this.sessions = new Map();
  }
  get(sid) { return this.sessions.get(sid); }
  set(sid, data) { this.sessions.set(sid, data); }
  size() { return this.sessions.size; }
}
```

It looks fine. It looks so fine that, when I showed it to two other engineers, both said "yeah that's a `Map`, what about it?"

The thing about a `Map` is that the GC can never collect anything inside it. Every entry is a strong reference from a long-lived object (the `Map`) to a long-lived object (the session). The session is "in use" for the entire life of the process, and the `Map` is the only thing deciding otherwise.

So on Day 1 I "fix" the cache by adding an LRU. I find a library, `lru-cache`, plug it in, set `max: 10_000`, deploy. RSS plateaus, briefly. Then it starts climbing again.

That's the thing about memory leaks. You can fix one and not know whether you fixed the one that was actually hurting you, or whether you've just papered over a different one.

---

## Day 2 — "It's not the cache, it's the interval"

I add metrics. We have a `setInterval` running every second that aggregates a per-user rollup for the dashboard. The code is the kind of thing you write once and never look at again:

```js
// src/utils/stats.js
function startMetricsLoop(sessionCache) {
  setInterval(() => {
    let totalEvents = 0;
    let totalUsers = sessionCache.size();
    for (const [, session] of sessionCache.sessions) {
      totalEvents += session.events.length;
    }
    // ... emit metrics ...
  }, 1000);
}
```

I stare at this for ten minutes. The interval is on a 1-second cadence. It captures the cache via closure. The cache is the long-lived object.

But wait — that's actually the *correct* shape for a metrics loop. The interval is allowed to hold a reference to the cache. The cache is *supposed* to live for the life of the process. So what is this closure actually keeping alive that shouldn't be?

The answer is: nothing. The interval is fine.

What is *not* fine is what happens at 4 AM on Sunday when a SIGTERM arrives. There is no `clearInterval` anywhere. The interval keeps ticking. The process exits, but the closure pin pattern meant that, if we had a more elaborate setup, the interval would prevent the process from exiting at all. We didn't, but the next person might.

So on Day 2 I "fix" the interval. I capture the handle, call `.unref()`, add a SIGTERM handler. Deploy. RSS plateaus, again. Then climbs again.

I am now zero for two. Time to learn how to actually see what's happening.

---

## Day 3 — The workflow

The morning of Day 3 I open a fresh terminal and decide I'm not going to guess anymore. I'm going to **see**.

### Step 1: run with `--expose-gc`

`--expose-gc` adds a `global.gc()` function. That sounds like a debug-build flag, but it's stable, ships with every Node binary, and is essential for clean snapshots.

Why essential? V8 has *two* notions of size:

- **Reachable set** — everything the GC could possibly reach right now.
- **Retained set** — everything that would be collected if you removed a specific reference.

A heap snapshot taken without forcing GC shows you the reachable set, which includes a lot of objects that *are* garbage but haven't been collected yet. That drowns the signal. Forcing `global.gc()` first gives you the retained set, which is what you want to diff.

So:

```bash
node --expose-gc src/leaky-server.js
```

### Step 2: take a baseline snapshot

A heap snapshot is just a JSON file written by V8. Node has shipped `v8.writeHeapSnapshot()` since 11.13. The simplest possible snapshotter is one line:

```js
// scripts/snapshot.js
const v8 = require('v8');
const path = require('path');

function take(label = 'snapshot') {
  if (typeof global.gc === 'function') {
    global.gc();   // force a major GC so the snapshot reflects retained set
  }
  const file = path.join('snapshots', `${label}-${Date.now()}.heapsnapshot`);
  v8.writeHeapSnapshot(file);
  return file;
}
```

I wired this into the running server via a debug-only endpoint:

```js
// src/leaky-server.js
if (process.env.ENABLE_SNAPSHOT_ENDPOINT === '1') {
  const v8 = require('v8');
  const path = require('path');
  app.post('/__snapshot', (req, res) => {
    if (typeof global.gc === 'function') global.gc();
    const file = path.join('snapshots',
      `${req.query.label || 'snap'}-${Date.now()}.heapsnapshot`);
    v8.writeHeapSnapshot(file);
    res.json({ file });
  });
}
```

Now I can do, in any terminal:

```bash
curl -X POST 'http://localhost:3000/__snapshot?label=baseline'
```

Two notes on this:

- It only works when `ENABLE_SNAPSHOT_ENDPOINT=1` is set, so production doesn't accidentally expose it.
- Snapshots are *expensive* — they walk the entire heap. A 1 GB process takes ~3 seconds and writes a ~1 GB file. Don't do this on a hot path.

I take the baseline snapshot now, while the server is warm but idle.

### Step 3: exercise the suspect code

I hit the server with a few minutes of representative traffic. The load generator in the repo is intentionally boring:

```js
// test/load.js
for (let i = 0; i < 5000; i++) {
  await post(`${url}/track`, {
    userId: `u_${i}`,
    event: { type: 'pageview', payload: { path: `/p/${i % 200}` } },
  });
}
```

Nothing exotic. Realistic enough to grow whatever's going to grow.

### Step 4: take a second snapshot

Same endpoint, different label:

```bash
curl -X POST 'http://localhost:3000/__snapshot?label=post'
```

### Step 5: diff them

Here's where it gets interesting. The standard advice is "open both in Chrome DevTools and compare." That works. It's also a 5-minute click-fest. I want a 20-second answer first.

A heap snapshot file looks like this (lightly abridged):

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type","name","id","self_size","edge_count", ...],
      "node_types": [["hidden","array","string","object","code","closure", ...]]
    }
  },
  "nodes": [/* flat array, 7 ints per node */],
  "edges": [/* flat array, 3 ints per edge */],
  "strings": [/* string table */]
}
```

So a "node" is just 7 ints, one of which is an index into the type table, another into the string table. Walking the file is mechanical. I wrote a coarse diff tool that:

1. Walks `nodes` once for each file.
2. Groups by `name` (i.e., constructor — "Object", "Array", "Map", or your class name).
3. Computes count delta and self_size delta.
4. Prints the top 20 growers.

The full tool is in the repo, but the core is:

```js
// scripts/diff-snapshots.js (excerpt)
const fields = meta.node_fields;
const typeNames = meta.node_types[0];
const rowSize = fields.length;
const idx = {
  type: fields.indexOf('type'),
  name: fields.indexOf('name'),
  self_size: fields.indexOf('self_size'),
};
const byCtor = new Map();

for (let i = 0; i < nodes.length; i += rowSize) {
  const typeLabel = typeNames[nodes[i + idx.type]];
  const nameLabel = typeLabel === 'object'
    ? raw.strings[nodes[i + idx.name]]
    : `(${typeLabel})`;
  byCtor.set(nameLabel, (byCtor.get(nameLabel) || 0) + 1);
}
```

When I ran it on the leaky server after the load, this is what came out:

```
=== HEAP DIFF ===
before: 208577 nodes  13.5MB self_size
after : 198222 nodes  12.9MB self_size

Top 20 growing constructors (by instance count):

  ctor                                            before → after    Δ count       Δ size
  --------------------------------------------------------------------------------------
  Object                                         19212 →  24779  +    5567     191.6KB
  (number)                                        6625 →   9077  +    2452      38.3KB
  (code)                                         32814 →  33314  +     500     281.4KB
  (hidden)                                       11216 →  11379  +     163      17.8KB
  ...
```

`Object` count grew by 5,567. `(number)` by 2,452. Everything else is noise.

That was the first concrete signal I'd had in three days. We had a leak, and it was an `Object`-shaped leak — which is what you'd expect from session data with a metadata bag, an events array, and a payload object per event.

### Step 6: open both in DevTools, follow the retainers

The CLI diff tells you *what* is leaking. It can't tell you *why*. For that, you need DevTools.

1. Chrome → DevTools → Memory.
2. Click **Load**, pick `baseline-*.heapsnapshot`.
3. Click the dropdown at the top, switch to **Comparison**, load `post-*.heapsnapshot`.
4. Sort by **# Delta** or **Size Delta**.
5. Click the biggest growing constructor.
6. Look at the **retainers** pane at the bottom.

The retainers pane is the answer. It shows the chain of references from the GC roots down to the selected object. For my leak, that chain was:

```
Window
└─ Module
   └─ Express app
      └─ SessionCache (the wrapper)
         └─ sessions (a Map)
            ├─ "u_0" → { userId, metadata, events: [...] }
            ├─ "u_1" → ...
            └─ "u_4999" → ...
```

The `Map` was the retention source. Every session was a strong reference inside it. No GC could ever reclaim any of them. The fix wasn't "add LRU" — I'd already tried that, and LRU eviction happens *in the application* on insert, but the underlying *cause* was the missing bound. The fix was to **actually have a bound**, in code that I trusted to enforce it.

### Step 7: the actual fix

The fixed cache is a 30-line LRU that lives next to the leaky one:

```js
// src/utils/safe-cache.js
class SafeSessionCache {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.sessions = new Map();
  }

  get(sid) {
    if (!this.sessions.has(sid)) return undefined;
    const value = this.sessions.get(sid);
    // Refresh recency: delete + re-set puts it at the back.
    this.sessions.delete(sid);
    this.sessions.set(sid, value);
    return value;
  }

  set(sid, data) {
    if (this.sessions.has(sid)) {
      this.sessions.delete(sid);
    } else if (this.sessions.size >= this.maxEntries) {
      // Map iterates in insertion order, so the first key is the LRU.
      const oldest = this.sessions.keys().next().value;
      this.sessions.delete(oldest);
    }
    this.sessions.set(sid, data);
  }

  size() { return this.sessions.size; }
  clear() { this.sessions.clear(); }
}
```

The interval I rewrote so the handle is returned, the closure is gone, and the process can shut down cleanly:

```js
// src/utils/safe-stats.js
function startMetricsLoop(getSnapshot, { intervalMs = 1000 } = {}) {
  const handle = setInterval(() => {
    const snap = getSnapshot();   // pull, not closure-capture
    // emit snap ...
  }, intervalMs);
  handle.unref();   // don't keep the process alive
  return handle;
}
```

The admin snapshot cache became a bounded ring buffer:

```js
// src/utils/safe-admin-stats.js
class SafeAdminStatsCache {
  constructor({ maxEntries = 100 } = {}) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
  }
  record(snapshot) {
    const key = new Date().toISOString();
    this.cache.set(key, snapshot);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }
  // ...
}
```

And the SIGTERM handler that should've been there from day one:

```js
// src/fixed-server.js
let metricsHandle = null;

function shutdown(signal) {
  console.log(`[fixed] received ${signal}, shutting down`);
  if (metricsHandle) clearInterval(metricsHandle);
  sessions.clear();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

I deployed. RSS dropped to a flat 240 MB, then stayed there. The verification script in the repo (`scripts/verify-fixed.js`) reproduces this:

```
[verify-fixed] after warm-up: { rss_mb: 129.2, sessions: 3000, adminSnapshots: 5 }
[verify-fixed] after second load: { rss_mb: 131.6, sessions: 3000, adminSnapshots: 12 }
[verify-fixed] RSS delta:           2.4 MB
[verify-fixed] admin snap delta:    7
[verify-fixed] ✓ PASS — fixed server holds memory steady under same load
```

Same load as the leaky version. 2.4 MB of RSS growth vs ~70 MB.

---

## Day 4 — When you actually want `WeakRef`

The leak is fixed. RSS is flat. We're done.

We are not done. There's a related, subtle problem in the same area: a "preview cache" for big response objects. The user clicks a button, we generate a big response, we show them a preview. If they navigate away, the response object should be collectible, but we also want the preview to work for as long as the page is open.

The naive version is a `Map<requestId, bigResponse>`. That's Leak #1 reborn — the cache is now what's keeping the response alive past the user's interest in it.

The right tool here is `WeakRef`, with a `FinalizationRegistry` to clean up the *key* once the value dies:

```js
// src/utils/preview-cache.js
class PreviewCache {
  constructor() {
    this.previewByRequest = new Map();
    this.registry = new FinalizationRegistry((requestId) => {
      // Fires when the WeakRef's referent is collected.
      this.previewByRequest.delete(requestId);
    });
  }

  attach(requestId, previewObject) {
    this.previewByRequest.set(requestId, new WeakRef(previewObject));
    this.registry.register(previewObject, requestId);
  }

  get(requestId) {
    const ref = this.previewByRequest.get(requestId);
    if (!ref) return undefined;
    const obj = ref.deref();
    if (!obj) {
      this.previewByRequest.delete(requestId);
      return undefined;
    }
    return obj;
  }

  size() { return this.previewByRequest.size; }
}
```

The contract:

- `attach` stores a *weak* reference to the big object. If nothing else holds the object, it can be collected.
- `FinalizationRegistry` is a callback. When the object is collected, the registry calls us with the `requestId`, and we delete the key. Without this, the `Map` would slowly fill with dead `WeakRef` entries.
- `get` does the deref dance, and cleans up the dead `WeakRef` if it sees one.

Important caveats:

- `WeakRef` is **not** a memory-management silver bullet. It is a *specific* tool for "I want a cache lookup keyed by ID, but I do not want my cache to keep the value alive." If you reach for `WeakRef` to "fix a leak," you have a 50% chance of just moving the leak somewhere worse.
- `FinalizationRegistry` callbacks are not guaranteed to fire on any particular schedule. They are *eventually* called. Code that depends on the timing of those callbacks is incorrect.
- `WeakRef` cannot be cloned, cannot be the value of a `WeakMap` (use `WeakMap` directly), and does not work for primitive values.

The repo includes a verification script (`scripts/verify-weakref.js`) that asserts the big object *actually* gets collected after a strong reference is dropped. Without that assertion, you'd be guessing.

---

## The full workflow, summarized

This is the cheat sheet I now keep in my runbook:

1. **Run with `--expose-gc`.** Production won't, but your reproduction will.
2. **Take a baseline snapshot** before you exercise the app. Use `v8.writeHeapSnapshot()`. Force GC first.
3. **Exercise the app** with realistic traffic. The repo's `test/load.js` is a good template.
4. **Take a post snapshot.** Same procedure.
5. **Diff them.** `scripts/diff-snapshots.js` gives you a 20-second answer. Top growing constructors = suspects.
6. **Open both in DevTools Memory.** Switch to Comparison view. Click the biggest grower. Look at **retainers**. That's the chain to break.
7. **Fix the retention, not the symptom.** "Add LRU" is only a fix if the cache was actually the leak. Sometimes the leak is a forgotten interval, a growing array on a long-lived config object, a per-request listener that accumulates in an `EventEmitter`, a `WeakRef` that you forgot to `deref()`. The retainer tree shows you which.
8. **Verify.** Re-run the same load against the fixed version. RSS delta should be in the noise, not the tens of MB.

## What I'd do differently next time

A few notes for past-Sana:

- **Set memory limits in CI.** A test that asserts RSS stays below 250 MB after a representative load would have caught the bug on Day 1, not Day 3.
- **Add a `__diag` endpoint to every service.** Three lines of code, one `process.memoryUsage()` call, JSON response. We added it during the incident and have never removed it. It has paid for itself many times.
- **Bound every cache, in code review, every time.** "It's a cache" is not a defense. A cache without a bound is a slow leak.
- **Treat `setInterval` like a database connection.** You opened it. You close it. There's no in-between.

The leak itself wasn't interesting. What's interesting is that it took three days to see it, when the workflow to see it takes twenty minutes. The tool was there. The discipline wasn't.

That part, I'm working on.

---

*All code in this post is from the companion repo, [github.com/sana/nodejs-memory-leak-hunt](https://github.com/sana/nodejs-memory-leak-hunt), which is structured as a git-ready project you can clone and run.*

*If you have your own favorite heap-snapshot war story, drop it in the comments. I collect them.*
