#!/usr/bin/env bash
# scripts/reproduce-leak.sh
# One-command reproduction of the entire hunt:
#   1. Start the leaky server.
#   2. Warm it up with traffic.
#   3. Take a "baseline" heap snapshot.
#   4. Hit it with more traffic.
#   5. Take a "post" heap snapshot.
#   6. Diff the two so the growth is obvious.
#   7. Leave the server running for interactive DevTools investigation.
#
# Then run:
#   npm run start:fixed   # on a different port
#   PORT=3001 node test/load.js http://localhost:3001 5000 3
# And watch memory stay flat.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
USERS="${USERS:-5000}"
ROUNDS="${ROUNDS:-2}"

echo "==> starting leaky server on :$PORT"
node --expose-gc src/leaky-server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# Wait for boot.
for i in {1..30}; do
  if curl -sf "http://localhost:$PORT/health" > /dev/null; then break; fi
  sleep 0.2
done

echo "==> warming up: $USERS users × 1 round"
node test/load.js "http://localhost:$PORT" "$USERS" 1

echo "==> baseline snapshot"
node -e "require('./scripts/snapshot').take('leaky-baseline')"

echo "==> more traffic: $USERS users × $ROUNDS more rounds"
node test/load.js "http://localhost:$PORT" "$USERS" "$ROUNDS"

echo "==> post snapshot"
node -e "require('./scripts/snapshot').take('leaky-post')"

echo "==> diffing snapshots"
node scripts/diff-snapshots.js \
  snapshots/leaky-baseline-*.heapsnapshot \
  snapshots/leaky-post-*.heapsnapshot

echo ""
echo "==> server still running on :$PORT (pid $SERVER_PID)"
echo "    Open Chrome DevTools → Memory → Load Heap Snapshot, then"
echo "    snapshots/leaky-baseline-*.heapsnapshot and snapshots/leaky-post-*.heapsnapshot"
echo "    to investigate interactively."
echo "    Or, in another terminal, run:"
echo "      curl localhost:$PORT/__diag"
echo ""
echo "Press Ctrl-C to stop the server."
wait $SERVER_PID
