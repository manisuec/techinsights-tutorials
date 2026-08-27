# Tech Insights Tutorials


Each folder is a self-contained example. Clone the whole repo or just `cd` into the one you need.

| Example | Post | Description | Notes |
|---------|------|-------------|-------|
| [nodejs-memory-leak](./nodejs-memory-leak) | [I Chased a Node.js Memory Leak…](https://medium.com/@manisuec/3-days-chasing-a-node-js-memory-leak-the-heap-snapshot-workflow-that-found-it-fde30a5834bd) | Deliberately leaky service + heap snapshot workflow | Full project, scripts, tests |
| [typescript-mcp-server](./typescript-mcp-server) | [Building a Production MCP Server…](https://medium.com/@manisuec/building-a-production-mcp-server-in-typescript-e35ad4319a35) | Streamable HTTP MCP server with auth, rate limiting, etc. | Production-style |
| [nodejs-test-runner](./nodejs-test-runner) | [Node’s Native Test Runner vs Jest vs Vitest…](https://medium.com/@manisuec/nodes-native-test-runner-vs-jest-vs-vitest-one-suite-three-runners-real-timings-b78b143fb7a9) | Same 29-test suite on three runners + benchmarks | |
| [pino-http-context](./pino-http-context) | [Setup logging with Pino and express-http-context in Expressjs](https://techinsights.manisuec.com/nodejs/pino-logger-express-http-context/) | storing and fetching request-scoped context | |
| [mongoose-hooks](./mongoose-hooks) | [Understanding Mongoose Pre and Post middleware hooks](https://techinsights.manisuec.com/mongodb/mongoose-pre-and-post-hooks-middlewares/) | Pre and post middleware hooks | Minimal snippet |
| … | | | |

## How to use
```bash
git clone https://github.com/manisuec/techinsights-tutorials.git
cd techinsights-tutorials/<example>
# follow the README inside
