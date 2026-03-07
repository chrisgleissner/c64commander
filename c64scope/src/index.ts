#!/usr/bin/env node
import { runScopeServer } from "./server.js";

runScopeServer().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
