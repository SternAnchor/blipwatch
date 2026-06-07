import { PNG } from "pngjs";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarSpoke } from "./decoder.js";

export interface RadarImageRenderer {
  readonly imageSize: number;
  applySpoke(spoke: RadarSpoke): void;
  getLatestMetadata(): RadarImageMetadata;
  getLatestPng(): Buffer;
}

interface RadarImageRendererOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

export interface RadarImageMetadata {
  readonly imageSize: number;
  readonly lastFrameAt: string | null;
  readonly lastSpokeAt: string | null;
  readonly maxIntensity: number;
  readonly renderState: "empty" | "ready";
  readonly spokeCount: number;
}

export const createRadarImageRenderer = ({ config, logger }: RadarImageRendererOptions): RadarImageRenderer => {
  const image = new PNG({
    colorType: 6,
    height: config.imageSize,
    inputColorType: 6,
    inputHasAlpha: true,
    width: config.imageSize
  });
  clearImage(image);
  let lastFrameAt: Date | undefined;
  let lastSpokeAt: Date | undefined;
  let maxIntensity = 0;
  let spokeCount = 0;

  logger.debug(`radar renderer initialized at ${config.imageSize}px`);

  return {
    applySpoke(spoke: RadarSpoke): void {
      try {
        drawSpoke(image, spoke);
        spokeCount += 1;
        maxIntensity = Math.max(maxIntensity, spoke.maxIntensity);
        lastSpokeAt = spoke.receivedAt ?? new Date();
        lastFrameAt = new Date();
        logger.debug(
          `radar spoke rendered angle=${spoke.angleDegrees} samples=${spoke.sampleCount} maxIntensity=${spoke.maxIntensity}`
        );
      } catch (error) {
        logger.error("failed to render radar spoke", error);
      }
    },
    getLatestMetadata(): RadarImageMetadata {
      return {
        imageSize: config.imageSize,
        lastFrameAt: lastFrameAt?.toISOString() ?? null,
        lastSpokeAt: lastSpokeAt?.toISOString() ?? null,
        maxIntensity,
        renderState: spokeCount === 0 ? "empty" : "ready",
        spokeCount
      };
    },
    getLatestPng(): Buffer {
      return PNG.sync.write(image);
    },
    imageSize: config.imageSize
  };
};

const clearImage = (image: PNG): void => {
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 0;
    image.data[index + 1] = 0;
    image.data[index + 2] = 0;
    image.data[index + 3] = 255;
  }
};

const drawSpoke = (image: PNG, spoke: RadarSpoke): void => {
  const center = Math.floor(image.width / 2);
  const maxRadius = Math.max(Math.floor(image.width / 2) - 1, 1);
  const angleRadians = (spoke.angleDegrees * Math.PI) / 180;
  const sampleDenominator = Math.max(spoke.intensities.length - 1, 1);

  for (const [sampleIndex, intensity] of spoke.intensities.entries()) {
    const radius = (sampleIndex / sampleDenominator) * maxRadius;
    const x = Math.round(center + Math.sin(angleRadians) * radius);
    const y = Math.round(center - Math.cos(angleRadians) * radius);
    setPixel(image, x, y, intensity);
  }
};

const setPixel = (image: PNG, x: number, y: number, intensity: number): void => {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) {
    return;
  }

  const offset = (y * image.width + x) * 4;
  image.data[offset] = 0;
  image.data[offset + 1] = intensity;
  image.data[offset + 2] = 0;
  image.data[offset + 3] = 255;
};
