// scripts/diff-snapshots.js
// Read two .heapsnapshot files and produce a coarse diff.
//
//   - total node/edge count
//   - top constructors by instance count delta
//   - size delta estimate (sum of self_size)
//
// This is the "20-second" version of dragging both files into Chrome
// DevTools. It won't replace the DevTools UI, but it tells you where
// to look.
//
// Usage:
//   node scripts/diff-snapshots.js <before.heapsnapshot> <after.heapsnapshot>

const fs = require('fs');
const path = require('path');

function loadSnapshot(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const meta = raw.snapshot.meta;
  const fields = meta.node_fields;
  const typeNames = meta.node_types[0];
  const rowSize = fields.length;

  const idx = {
    type: fields.indexOf('type'),
    name: fields.indexOf('name'),
    id: fields.indexOf('id'),
    self_size: fields.indexOf('self_size'),
    edge_count: fields.indexOf('edge_count'),
  };

  // Per-constructor aggregates.
  const byCtor = new Map();   // ctor label -> count
  const sizeByCtor = new Map(); // ctor label -> total self_size

  let totalSize = 0;
  const nodes = raw.nodes;
  for (let i = 0; i < nodes.length; i += rowSize) {
    const typeIdx = nodes[i + idx.type];
    const nameIdx = nodes[i + idx.name];
    const selfSize = nodes[i + idx.self_size];

    const typeLabel = typeNames[typeIdx] || `type${typeIdx}`;
    const nameLabel = typeLabel === 'object' || typeLabel === 'closure'
      ? raw.strings[nameIdx]
      : `(${typeLabel})`;

    byCtor.set(nameLabel, (byCtor.get(nameLabel) || 0) + 1);
    sizeByCtor.set(nameLabel, (sizeByCtor.get(nameLabel) || 0) + selfSize);
    totalSize += selfSize;
  }

  return {
    meta,
    totalNodes: nodes.length / rowSize,
    totalEdges: raw.edges.length / meta.edge_fields.length,
    totalSize,
    byCtor,
    sizeByCtor,
  };
}

function fmtBytes(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  if (n > 1024) return (n / 1024).toFixed(1) + 'KB';
  return n + 'B';
}

function diff(before, after, { topN = 20 } = {}) {
  const ctors = new Set([
    ...before.byCtor.keys(),
    ...after.byCtor.keys(),
  ]);

  const rows = [];
  for (const ctor of ctors) {
    const bCount = before.byCtor.get(ctor) || 0;
    const aCount = after.byCtor.get(ctor) || 0;
    const dCount = aCount - bCount;
    const bSize = before.sizeByCtor.get(ctor) || 0;
    const aSize = after.sizeByCtor.get(ctor) || 0;
    const dSize = aSize - bSize;
    if (dCount !== 0 || dSize !== 0) {
      rows.push({ ctor, bCount, aCount, dCount, bSize, aSize, dSize });
    }
  }

  rows.sort((x, y) => y.dCount - x.dCount);

  console.log(`\n=== HEAP DIFF ===`);
  console.log(`before: ${path.basename(process.argv[2])}`);
  console.log(`        ${before.totalNodes} nodes  ${fmtBytes(before.totalSize)} self_size`);
  console.log(`after : ${path.basename(process.argv[3])}`);
  console.log(`        ${after.totalNodes} nodes  ${fmtBytes(after.totalSize)} self_size`);
  console.log(`        Δ   ${after.totalNodes - before.totalNodes} nodes  ${fmtBytes(after.totalSize - before.totalSize)} self_size`);

  console.log(`\nTop ${topN} growing constructors (by instance count):\n`);
  console.log(
    '  ctor'.padEnd(46),
    'before → after'.padStart(17),
    'Δ count'.padStart(10),
    'Δ size'.padStart(12),
  );
  console.log('  ' + '-'.repeat(86));

  for (const r of rows.slice(0, topN)) {
    const name = r.ctor.length > 44 ? r.ctor.slice(0, 41) + '...' : r.ctor.padEnd(44);
    const arrow = `${String(r.bCount).padStart(6)} → ${String(r.aCount).padStart(6)}`;
    console.log(
      `  ${name}  ${arrow}  ${(r.dCount > 0 ? '+' : '') + String(r.dCount).padStart(8)}  ${fmtBytes(r.dSize).padStart(10)}`,
    );
  }

  const growing = rows.filter((r) => r.dCount > 50).slice(0, 5).map((r) => r.ctor);
  console.log(`\nHint: open both files in Chrome DevTools → Memory → Load, then compare.`);
  console.log(`      Focus on the largest growing constructors above.`);
  if (growing.length) {
    console.log(`\nMost suspicious growth: ${growing.join(', ')}\n`);
  } else {
    console.log(`\nNo constructor grew by more than 50 instances — investigate retained paths in DevTools.\n`);
  }
}

if (require.main === module) {
  const [, , a, b] = process.argv;
  if (!a || !b) {
    console.error('Usage: node scripts/diff-snapshots.js <before> <after>');
    process.exit(1);
  }
  diff(loadSnapshot(a), loadSnapshot(b));
}
