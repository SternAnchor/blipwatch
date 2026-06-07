import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";

export interface ReplayBuffer {
  readonly retentionSeconds: number;
}

interface ReplayBufferOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

export const createReplayBuffer = ({ config, logger }: ReplayBufferOptions): ReplayBuffer => {
  logger.debug(`replay buffer initialized for ${config.replayRetentionSeconds}s`);
  return {
    retentionSeconds: config.replayRetentionSeconds
  };
};
