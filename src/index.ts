import { createBlipWatchServer } from "./server.js";

const server = createBlipWatchServer();

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
