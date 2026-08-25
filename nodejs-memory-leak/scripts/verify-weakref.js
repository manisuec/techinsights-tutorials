// scripts/verify-weakref.js
// Validates that the PreviewCache actually collects the underlying big
// object once nothing else holds a reference. If this test ever fails,
// FinalizationRegistry or WeakRef semantics changed.

const path = require('path');
const { PreviewCache } = require(path.resolve(__dirname, '..', 'src', 'utils', 'preview-cache'));

async function main() {
  const cache = new PreviewCache();

  let big = { name: 'huge', blob: new Array(50_000).fill('x').join('') };
  cache.attach('req-1', big);

  console.log('attached, cache size =', cache.size());
  console.log('before drop: get =', cache.get('req-1')?.name);

  // Drop the strong reference. The big object is now only reachable via
  // the WeakRef inside the cache.
  big = null;

  if (typeof global.gc !== 'function') {
    console.error('run with `node --expose-gc` to force collection');
    process.exit(1);
  }

  // Force GC + yield repeatedly. FinalizationRegistry callbacks are
  // processed asynchronously and the heap may take a few passes to settle.
  let attempts = 0;
  while (cache.size() > 0 && attempts < 10) {
    global.gc();
    await new Promise((r) => setImmediate(r));
    attempts++;
  }
  console.log(`forcing collection took ${attempts} GC passes`);

  console.log('after drop + GC: cache size =', cache.size());
  const fetched = cache.get('req-1');
  console.log('after drop + GC: get(\'req-1\') =', fetched ? fetched.name : undefined);

  if (fetched !== undefined) {
    console.error('\n✗ FAIL — big object was retained after strong ref was dropped');
    process.exit(2);
  }
  if (cache.size() !== 0) {
    console.error('\n✗ FAIL — cache should have evicted via FinalizationRegistry');
    process.exit(2);
  }
  console.log('\n✓ PASS — WeakRef + FinalizationRegistry collected the big object');
}

main().catch((e) => { console.error(e); process.exit(1); });
