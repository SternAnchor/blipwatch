import { createHttpApi } from "./api/http-api.js";
import { loadConfig } from "./config/config.js";
import { createLogger, type Logger } from "./logging/logger.js";
import { createRadarDecoder } from "./radar/decoder.js";
import { createRadarImageRenderer } from "./radar/renderer.js";
import { createRadarReceiver } from "./radar/receiver.js";
import { createReplayBuffer } from "./replay/replay-buffer.js";

export interface BlipWatchServer {
  readonly logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const createBlipWatchServer = (): BlipWatchServer => {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  const receiver = createRadarReceiver({ config, logger });
  const decoder = createRadarDecoder({ logger });
  const renderer = createRadarImageRenderer({ config, logger });
  const replayBuffer = createReplayBuffer({ config, logger });
  const httpApi = createHttpApi({ config, logger, renderer, replayBuffer });

  return {
    logger,
    async start(): Promise<void> {
      logger.info(`starting BlipWatch on port ${config.port}`);
      await httpApi.start();
      receiver.start();
      logger.debug(`decoder ready: ${decoder.name}`);
    },
    async stop(): Promise<void> {
      receiver.stop();
      await httpApi.stop();
      logger.info("BlipWatch stopped");
    }
  };
};
