import { createApp } from "./app.js";
import { config, isDevAuth } from "./config.js";

const { app, sessions } = createApp();

const httpServer = app.listen(config.PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "mcp_server_listening",
      port: config.PORT,
      env: config.NODE_ENV,
      auth: isDevAuth ? "dev-static-token" : "jwks",
    })
  );
  if (isDevAuth) {
    console.warn("WARNING: static development token is in use. Never do this in production.");
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", msg: "shutting_down", signal }));
  // Stop accepting new connections first, then close live sessions so
  // in-flight SSE streams end cleanly rather than being cut.
  httpServer.close();
  await sessions.closeAll();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
