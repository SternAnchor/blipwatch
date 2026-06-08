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
  const intensityMap = new Uint8Array(config.imageSize * config.imageSize);
  clearImage(image);
  let lastFrameAt: Date | undefined;
  let lastSpokeAt: Date | undefined;
  let maxIntensity = 0;
  let latestPng: Buffer | undefined;
  let spokeCount = 0;

  logger.debug(`radar renderer initialized at ${config.imageSize}px`);

  return {
    applySpoke(spoke: RadarSpoke): void {
      try {
        drawSpoke(image, intensityMap, spoke);
        spokeCount += 1;
        maxIntensity = Math.max(maxIntensity, spoke.maxIntensity);
        lastSpokeAt = spoke.receivedAt ?? new Date();
        lastFrameAt = new Date();
        latestPng = undefined;
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
      latestPng ??= PNG.sync.write(image);
      return latestPng;
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

const drawSpoke = (image: PNG, intensityMap: Uint8Array, spoke: RadarSpoke): void => {
  const center = Math.floor(image.width / 2);
  const maxRadius = Math.max(Math.floor(image.width / 2) - 1, 1);
  const angleRadians = (spoke.angleDegrees * Math.PI) / 180;
  const sampleDenominator = Math.max(spoke.intensities.length - 1, 1);
  const footprintRadius = getFootprintRadius(image.width);

  for (const [sampleIndex, intensity] of spoke.intensities.entries()) {
    if (intensity === 0) {
      continue;
    }

    const radius = (sampleIndex / sampleDenominator) * maxRadius;
    const x = Math.round(center + Math.sin(angleRadians) * radius);
    const y = Math.round(center - Math.cos(angleRadians) * radius);
    drawReturn(image, intensityMap, x, y, intensity, footprintRadius);
  }
};

const getFootprintRadius = (imageSize: number): number => Math.max(1, Math.round(imageSize / 256));

const drawReturn = (
  image: PNG,
  intensityMap: Uint8Array,
  centerX: number,
  centerY: number,
  intensity: number,
  footprintRadius: number
): void => {
  const radius = intensity >= 192 ? footprintRadius * 2 : footprintRadius;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distanceSquared > radius ** 2) {
        continue;
      }

      const falloff = radius > 1 ? 1 - Math.sqrt(distanceSquared) / (radius + 1) : 1;
      setPixel(image, intensityMap, x, y, Math.max(1, Math.round(intensity * falloff)));
    }
  }
};

const setPixel = (image: PNG, intensityMap: Uint8Array, x: number, y: number, intensity: number): void => {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) {
    return;
  }

  const pixelIndex = y * image.width + x;
  const currentIntensity = intensityMap[pixelIndex] ?? 0;
  if (intensity <= currentIntensity) {
    return;
  }

  intensityMap[pixelIndex] = intensity;
  const offset = (y * image.width + x) * 4;
  const color = colorizeIntensity(intensity);
  image.data[offset] = color.red;
  image.data[offset + 1] = color.green;
  image.data[offset + 2] = color.blue;
  image.data[offset + 3] = 255;
};

const colorizeIntensity = (intensity: number): { readonly blue: number; readonly green: number; readonly red: number } => {
  if (intensity >= 192) {
    return { blue: 48, green: 96, red: 255 };
  }

  if (intensity >= 128) {
    return { blue: 32, green: 176, red: 255 };
  }

  if (intensity >= 64) {
    return { blue: 64, green: 224, red: 220 };
  }

  return { blue: 192, green: 192, red: 0 };
};
