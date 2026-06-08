#!/usr/bin/env node

import { ConfigurationError, createBlipWatchServer } from "./server.js";

try {
  const server = createBlipWatchServer(process.env);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.logger.info(`received ${signal}; shutting down`);
    await server.stop();
  };

  process.once("SIGINT", (signal) => {
    void shutdown(signal);
  });

  process.once("SIGTERM", (signal) => {
    void shutdown(signal);
  });

  await server.start();
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`failed to start BlipWatch: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.error("failed to start BlipWatch", error);
    process.exitCode = 1;
  }
}
