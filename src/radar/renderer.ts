import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";

export interface RadarImageRenderer {
  readonly imageSize: number;
}

interface RadarImageRendererOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

export const createRadarImageRenderer = ({ config, logger }: RadarImageRendererOptions): RadarImageRenderer => {
  logger.debug(`radar renderer initialized at ${config.imageSize}px`);
  return {
    imageSize: config.imageSize
  };
};
