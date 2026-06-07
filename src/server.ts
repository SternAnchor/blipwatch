import { createHttpApi } from "./api/http-api.js";
import { ConfigurationError, loadConfig } from "./config/config.js";
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

export const createBlipWatchServer = (env: NodeJS.ProcessEnv = process.env): BlipWatchServer => {
  const config = loadConfig(env);
  const logger = createLogger({ level: config.logLevel });
  const receiver = createRadarReceiver({ config, logger });
  const decoder = createRadarDecoder({ logger });
  const renderer = createRadarImageRenderer({ config, logger });
  const replayBuffer = createReplayBuffer({ config, logger });
  const httpApi = createHttpApi({ config, logger, renderer, replayBuffer });

  return {
    logger,
    async start(): Promise<void> {
      logger.debug(`loaded config: ${JSON.stringify(redactConfig(config))}`);
      logger.info(`starting BlipWatch on port ${config.port}`);
      await httpApi.start();
      receiver.onPacket((packet) => {
        const result = decoder.decode(packet);
        if (result.ok) {
          renderer.applySpoke(result.spoke);
        }
      });
      await receiver.start();
      logger.debug(`decoder ready: ${decoder.name}`);
      logger.debug(`renderer ready: ${renderer.imageSize}px`);
      logger.debug(`replay buffer ready: ${replayBuffer.retentionSeconds}s`);
    },
    async stop(): Promise<void> {
      await receiver.stop();
      await httpApi.stop();
      logger.info("BlipWatch stopped");
    }
  };
};

export { ConfigurationError };

const redactConfig = (config: ReturnType<typeof loadConfig>): Record<string, number | string> => ({
  imageSize: config.imageSize,
  logLevel: config.logLevel,
  port: config.port,
  radarInterface: config.radarInterface,
  radarUdpPort: config.radarUdpPort,
  replayFrameIntervalMs: config.replayFrameIntervalMs,
  replayRetentionSeconds: config.replayRetentionSeconds
});
