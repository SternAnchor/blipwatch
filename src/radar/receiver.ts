import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";

export interface RadarReceiver {
  start(): void;
  stop(): void;
}

interface RadarReceiverOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

export const createRadarReceiver = ({ config, logger }: RadarReceiverOptions): RadarReceiver => ({
  start(): void {
    logger.info(`radar receiver placeholder ready on ${config.radarInterface}:${config.radarUdpPort}`);
  },
  stop(): void {
    logger.debug("radar receiver stopped");
  }
});
