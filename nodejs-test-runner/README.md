# Test Runners 2026 — One Suite, Three Runners, Real Timings

Companion repo to the blog post **"Node's Native Test Runner vs Jest vs Vitest in 2026."**

The same 29-test suite is implemented three times — once for each runner — so you can read the code, run it yourself, and reproduce the benchmark numbers on your own machine.

## Layout

```
.
├── src/
│   └── string-utils.js          # The system under test (shared by all three suites)
├── node-test/
│   └── test/string-utils.test.js   # node:test + node:assert
├── jest/
│   ├── jest.config.js
│   └── test/string-utils.test.js   # Jest 30
├── vitest/
│   ├── vitest.config.mjs
│   └── test/string-utils.test.js   # Vitest 4
├── shared/
│   └── bench.sh                 # Reproducible benchmark script
├── package.json
└── README.md
```

## Requirements

- **Node.js ≥ 22.0.0** (`node:test` is fully stable from Node 20; 22 LTS or newer is what these numbers were taken on)
- **npm** (any modern version)

The three runners:

| | Required for | Version pinned in `package.json` |
|---|---|---|
| `node:test` | nothing (ships with Node) | — |
| **Jest 30** | `npm install` | `^30.0.0` |
| **Vitest 4** | `npm install` | `^4.0.0` |

## Install

```bash
npm install
```

## Run any one runner

```bash
# node:test
npm run test:node
# or with watch mode
npm run test:node:watch
# or with coverage (V8)
npm run test:node:cov

# Jest 30
npm run test:jest
npm run test:jest:watch

# Vitest 4
npm run test:vitest
npm run test:vitest:watch
npm run test:vitest:cov
```

## Run the benchmark (the one the blog post cites)

```bash
bash shared/bench.sh 5
```

You'll see something like:

```
=== node:test  (Node v24.14.0) [cold] ===
  run 1: 91 ms
  run 2: 93 ms
  ...
=== Jest  (30.4.1) [cold] ===
  run 1: 817 ms
  ...
=== Vitest  (4.1.11) [cold] ===
  run 1: 548 ms
  ...
```

Reference run on the maintainer's machine (Apple Silicon, macOS, Node v24.14.0),
median of 5:

| | Cold | Warm | Install footprint |
|---|---|---|---|
| `node:test` | 90 ms | 89 ms | 0 |
| Jest 30.4.1 | 711 ms | 584 ms | 43 MB |
| Vitest 4.1.11 | 535 ms | 520 ms | 34 MB |

The script measures **wall-clock time** of each cold run (`--no-cache` is set where supported). Five runs is the default; pass a different number as the first arg.

## What the suite tests

A tiny utility module with four pure functions:

- `slugify(input)` — convert a string to a URL slug
- `truncate(input, max)` — truncate with an ellipsis
- `isPalindrome(input)` — case- and punctuation-insensitive palindrome check
- `countWords(input)` — count whitespace-separated words

Each function gets a `describe` block. Total: **29 tests, 4 suites, no I/O, no React, no async, no fixtures.** That's deliberate — this benchmark is about **runner overhead**, not framework features.

## The three test files, side by side

The same test cases live in three files. Compare them to see how portable the API is:

- `node-test/test/string-utils.test.js` — uses `node:test` + `node:assert/strict`
- `jest/test/string-utils.test.js` — uses Jest's `expect`. Jest 30 still needs `NODE_OPTIONS=--experimental-vm-modules` for native ESM; without it you get `SyntaxError: Cannot use import statement outside a module`. The npm scripts set it for you.
- `vitest/test/string-utils.test.js` — imports `describe`, `it`, `expect` from `vitest`

Most `describe`/`it`/`expect` calls are identical. The only differences are the import line and how you set up a config (Jest needs a config file, Vitest has one, `node:test` has none).

## Methodology notes

- **Cold run:** no cache. The script passes `--no-cache` to Jest and Vitest; `node:test` doesn't have a cache to clear.
- **Warm run:** run `WARM=1 bash shared/bench.sh 5`. That drops `--no-cache` so Jest and Vitest reuse their transform caches.
- **Hardware matters.** The numbers above came from Apple Silicon / macOS / Node v24.14.0. Yours will differ. The *shape* should match: `node:test` fastest by a wide margin, then Vitest, then Jest.
- **Suite size matters.** These numbers are for a 29-test pure-JS suite. The Vitest vs Jest gap widens significantly on larger TypeScript suites and especially in watch mode.

## License

MIT — use this code however you want.
