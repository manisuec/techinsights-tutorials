# Walkthrough — Three Days, One Leak

The condensed version of the story. For the full post, see
[`blog-post.md`](./blog-post.md).

## Day 0 — PagerDuty

RSS climbing at ~80 MB/hour, has been for nine hours. Restarts don't help.

## Day 1 — Suspect: the cache

`Map<userId, Session>` with no eviction. Every new user adds an entry
forever. "Fixed" by adding an LRU. RSS plateaus, briefly, then climbs
again. **Wrong target.**

## Day 2 — Suspect: the interval

`setInterval(1s)` capturing the cache via closure. Captured the handle,
called `.unref()`, added SIGTERM handler. RSS plateaus, again, then
climbs again. **Wrong target.**

## Day 3 — The workflow

1. **Run with `--expose-gc`.** Force GC before each snapshot for clean diffs.
2. **Baseline snapshot.** `v8.writeHeapSnapshot()` after a warm-up.
3. **Exercise the app.** Realistic traffic.
4. **Post snapshot.** Same procedure.
5. **Diff with `scripts/diff-snapshots.js`.** Top growing constructors = suspects.
6. **Open both in Chrome DevTools → Memory → Comparison.** Look at **retainers**.
7. **Fix the retention, not the symptom.** Bound the cache, clear the interval,
   cap the admin snapshots.
8. **Verify.** Same load against the fix. RSS delta should be in the noise.

## The fix (one breath)

- `SafeSessionCache` — bounded LRU, eviction on insert.
- `startMetricsLoop` — returns the handle, unref'd, no closure.
- `SafeAdminStatsCache` — bounded ring buffer.
- SIGTERM/SIGINT handlers that `clearInterval` and exit.
- `PreviewCache` — `WeakRef` + `FinalizationRegistry` for non-owning storage.

## Reproduce

```bash
npm install
npm run reproduce   # the full Day 3 workflow
node --expose-gc scripts/verify-fixed.js    # assert the fix holds
```

See the [blog post](./blog-post.md) for the full story.
