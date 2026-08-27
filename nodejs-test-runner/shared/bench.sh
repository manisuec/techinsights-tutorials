#!/usr/bin/env bash
# shared/bench.sh — reproducible cold-start benchmark for the three runners.
#
# Usage:  bash shared/bench.sh [N]
#           N     number of iterations (default 5)
#           WARM=1 bash shared/bench.sh [N]   omit --no-cache to measure warm runs
#
# Requires a `date` that supports %N (GNU coreutils, or macOS with coreutils on PATH).
set -u
N="${1:-5}"
WARM="${WARM:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$WARM" = "1" ]; then
  NOCACHE=""
  MODE="warm"
else
  NOCACHE="--no-cache"
  MODE="cold"
fi

if [ "$(date +%N)" = "N" ]; then
  echo "error: your 'date' does not support %N. Install GNU coreutils." >&2
  exit 1
fi

VITEST_VERSION="$(cd vitest && npx vitest --version 2>/dev/null | sed 's|vitest/||; s| .*||')"

printf "=== node:test  (Node %s) [%s] ===\n" "$(node --version)" "$MODE"
for i in $(seq 1 "$N"); do
  start=$(date +%s%N)
  node --test node-test/test/*.test.js > /dev/null 2>&1
  end=$(date +%s%N)
  printf "  run %d: %d ms\n" "$i" "$(( (end - start) / 1000000 ))"
done

printf "=== Jest  (%s) [%s] ===\n" "$(npx jest --version)" "$MODE"
for i in $(seq 1 "$N"); do
  start=$(date +%s%N)
  NODE_OPTIONS=--experimental-vm-modules npx jest --config jest/jest.config.js $NOCACHE > /dev/null 2>&1
  end=$(date +%s%N)
  printf "  run %d: %d ms\n" "$i" "$(( (end - start) / 1000000 ))"
done

printf "=== Vitest  (%s) [%s] ===\n" "$VITEST_VERSION" "$MODE"
for i in $(seq 1 "$N"); do
  start=$(date +%s%N)
  (cd vitest && npx vitest run $NOCACHE) > /dev/null 2>&1
  end=$(date +%s%N)
  printf "  run %d: %d ms\n" "$i" "$(( (end - start) / 1000000 ))"
done
