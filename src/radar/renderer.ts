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
  readonly activePixelCount: number;
  readonly imageSize: number;
  readonly lastFrameAt: string | null;
  readonly lastSpokeAt: string | null;
  readonly maxIntensity: number;
  readonly renderState: "empty" | "ready";
  readonly spokeCount: number;
  readonly targetFadeMs: number;
  readonly targetMaxAgeMs: number;
  readonly targetPersistenceMs: number;
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
  const updatedAtMap = new Float64Array(config.imageSize * config.imageSize);
  const renderState = {
    activePixelCount: 0
  };
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
        const renderedAt = spoke.receivedAt ?? new Date();
        drawSpoke(
          image,
          intensityMap,
          updatedAtMap,
          renderState,
          spoke,
          getDisplayRangeMeters(config.radarDisplayRangeMeters, spoke),
          renderedAt.getTime(),
          getTargetDecayConfig(config)
        );
        spokeCount += 1;
        maxIntensity = Math.max(maxIntensity, spoke.maxIntensity);
        lastSpokeAt = renderedAt;
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
      applyDecay(image, intensityMap, updatedAtMap, renderState, Date.now(), getTargetDecayConfig(config));
      return {
        activePixelCount: renderState.activePixelCount,
        imageSize: config.imageSize,
        lastFrameAt: lastFrameAt?.toISOString() ?? null,
        lastSpokeAt: lastSpokeAt?.toISOString() ?? null,
        maxIntensity,
        renderState: spokeCount === 0 ? "empty" : "ready",
        spokeCount,
        targetFadeMs: config.radarTargetFadeMs,
        targetMaxAgeMs: config.radarTargetMaxAgeMs,
        targetPersistenceMs: config.radarTargetPersistenceMs
      };
    },
    getLatestPng(): Buffer {
      if (applyDecay(image, intensityMap, updatedAtMap, renderState, Date.now(), getTargetDecayConfig(config))) {
        latestPng = undefined;
        lastFrameAt = new Date();
      }
      latestPng ??= PNG.sync.write(image);
      return latestPng;
    },
    imageSize: config.imageSize
  };
};

interface RenderState {
  activePixelCount: number;
}

interface TargetDecayConfig {
  readonly fadeMs: number;
  readonly maxAgeMs: number;
  readonly persistenceMs: number;
}

const clearImage = (image: PNG): void => {
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 0;
    image.data[index + 1] = 0;
    image.data[index + 2] = 0;
    image.data[index + 3] = 255;
  }
};

const getDisplayRangeMeters = (configuredRange: number | "auto", spoke: RadarSpoke): number => {
  if (configuredRange === "auto") {
    return spoke.rangeMeters;
  }

  return configuredRange;
};

const getTargetDecayConfig = (config: BlipWatchConfig): TargetDecayConfig => ({
  fadeMs: config.radarTargetFadeMs,
  maxAgeMs: config.radarTargetMaxAgeMs,
  persistenceMs: config.radarTargetPersistenceMs
});

const drawSpoke = (
  image: PNG,
  intensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  spoke: RadarSpoke,
  displayRangeMeters: number,
  renderedAtMs: number,
  decayConfig: TargetDecayConfig
): void => {
  const center = Math.floor(image.width / 2);
  const maxRadius = Math.max(Math.floor(image.width / 2) - 1, 1);
  const angleRadians = (spoke.angleDegrees * Math.PI) / 180;
  const sampleDenominator = Math.max(spoke.intensities.length - 1, 1);
  const metersPerSample = spoke.rangeMeters / sampleDenominator;
  const footprintRadius = getFootprintRadius(image.width);

  for (const [sampleIndex, intensity] of spoke.intensities.entries()) {
    if (intensity === 0) {
      continue;
    }

    const sampleRangeMeters = sampleIndex * metersPerSample;
    if (sampleRangeMeters > displayRangeMeters) {
      continue;
    }

    const radius = (sampleRangeMeters / displayRangeMeters) * maxRadius;
    const x = Math.round(center + Math.sin(angleRadians) * radius);
    const y = Math.round(center - Math.cos(angleRadians) * radius);
    drawReturn(image, intensityMap, updatedAtMap, renderState, x, y, intensity, footprintRadius, renderedAtMs, decayConfig);
  }
};

const getFootprintRadius = (imageSize: number): number => Math.max(1, Math.round(imageSize / 256));

const drawReturn = (
  image: PNG,
  intensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  centerX: number,
  centerY: number,
  intensity: number,
  footprintRadius: number,
  renderedAtMs: number,
  decayConfig: TargetDecayConfig
): void => {
  const radius = intensity >= 192 ? footprintRadius * 2 : footprintRadius;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distanceSquared > radius ** 2) {
        continue;
      }

      const falloff = radius > 1 ? 1 - Math.sqrt(distanceSquared) / (radius + 1) : 1;
      setPixel(
        image,
        intensityMap,
        updatedAtMap,
        renderState,
        x,
        y,
        Math.max(1, Math.round(intensity * falloff)),
        renderedAtMs,
        decayConfig
      );
    }
  }
};

const setPixel = (
  image: PNG,
  intensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  x: number,
  y: number,
  intensity: number,
  renderedAtMs: number,
  decayConfig: TargetDecayConfig
): void => {
  if (x < 0 || x >= image.width || y < 0 || y >= image.height) {
    return;
  }

  const pixelIndex = y * image.width + x;
  const currentIntensity = intensityMap[pixelIndex] ?? 0;
  const agedIntensity = getAgedIntensity(currentIntensity, renderedAtMs - (updatedAtMap[pixelIndex] ?? 0), decayConfig);
  if (agedIntensity !== currentIntensity) {
    updatePixel(
      image,
      intensityMap,
      updatedAtMap,
      renderState,
      pixelIndex,
      x,
      y,
      agedIntensity,
      updatedAtMap[pixelIndex] ?? renderedAtMs
    );
  }

  if (intensity <= agedIntensity) {
    return;
  }

  updatePixel(image, intensityMap, updatedAtMap, renderState, pixelIndex, x, y, intensity, renderedAtMs);
};

const applyDecay = (
  image: PNG,
  intensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  renderedAtMs: number,
  decayConfig: TargetDecayConfig
): boolean => {
  let changed = false;
  for (let pixelIndex = 0; pixelIndex < intensityMap.length; pixelIndex += 1) {
    const currentIntensity = intensityMap[pixelIndex] ?? 0;
    if (currentIntensity === 0) {
      continue;
    }

    const agedIntensity = getAgedIntensity(currentIntensity, renderedAtMs - (updatedAtMap[pixelIndex] ?? 0), decayConfig);
    if (agedIntensity === currentIntensity) {
      continue;
    }

    updatePixel(
      image,
      intensityMap,
      updatedAtMap,
      renderState,
      pixelIndex,
      pixelIndex % image.width,
      Math.floor(pixelIndex / image.width),
      agedIntensity,
      updatedAtMap[pixelIndex] ?? renderedAtMs
    );
    changed = true;
  }

  return changed;
};

const updatePixel = (
  image: PNG,
  intensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  pixelIndex: number,
  x: number,
  y: number,
  intensity: number,
  renderedAtMs: number
): void => {
  const previousIntensity = intensityMap[pixelIndex] ?? 0;
  if (previousIntensity === 0 && intensity > 0) {
    renderState.activePixelCount += 1;
  } else if (previousIntensity > 0 && intensity === 0) {
    renderState.activePixelCount -= 1;
  }

  intensityMap[pixelIndex] = intensity;
  updatedAtMap[pixelIndex] = intensity > 0 ? renderedAtMs : 0;
  const offset = (y * image.width + x) * 4;
  if (intensity === 0) {
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
    image.data[offset + 3] = 255;
    return;
  }

  const color = colorizeIntensity(intensity);
  image.data[offset] = color.red;
  image.data[offset + 1] = color.green;
  image.data[offset + 2] = color.blue;
  image.data[offset + 3] = 255;
};

const getAgedIntensity = (intensity: number, ageMs: number, config: TargetDecayConfig): number => {
  if (intensity === 0 || ageMs <= config.persistenceMs) {
    return intensity;
  }

  if (ageMs >= config.maxAgeMs) {
    return 0;
  }

  const fadeAgeMs = ageMs - config.persistenceMs;
  if (fadeAgeMs >= config.fadeMs) {
    return 0;
  }

  return Math.max(0, Math.round(intensity * (1 - fadeAgeMs / config.fadeMs)));
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
