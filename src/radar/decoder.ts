import type { Logger } from "../logging/logger.js";

export interface RadarDecoder {
  readonly name: string;
}

interface RadarDecoderOptions {
  readonly logger: Logger;
}

export const createRadarDecoder = ({ logger }: RadarDecoderOptions): RadarDecoder => {
  logger.debug("radar decoder initialized");
  return {
    name: "halo-placeholder-decoder"
  };
};
