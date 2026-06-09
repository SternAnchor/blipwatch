import { PNG } from "pngjs";

import type { BlipWatchConfig, RadarRenderPalette } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarSpoke } from "./decoder.js";

export interface RadarImageRenderer {
  readonly imageSize: number;
  applySpoke(spoke: RadarSpoke): void;
  clear(): void;
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
  readonly radarBrightnessScale: number;
  readonly radarRenderPalette: RadarRenderPalette;
  readonly renderState: "empty" | "ready";
  readonly spokeCount: number;
  readonly targetFadeMs: number;
  readonly targetExpansion: number;
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
  const returnIntensityMap = new Uint8Array(config.imageSize * config.imageSize);
  const displayIntensityMap = new Uint8Array(config.imageSize * config.imageSize);
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
          returnIntensityMap,
          displayIntensityMap,
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
    clear(): void {
      clearImage(image);
      returnIntensityMap.fill(0);
      displayIntensityMap.fill(0);
      updatedAtMap.fill(0);
      renderState.activePixelCount = 0;
      lastFrameAt = new Date();
      lastSpokeAt = undefined;
      maxIntensity = 0;
      latestPng = undefined;
      spokeCount = 0;
      logger.debug("radar renderer cleared");
    },
    getLatestMetadata(): RadarImageMetadata {
      applyDecay(image, returnIntensityMap, displayIntensityMap, updatedAtMap, renderState, Date.now(), getTargetDecayConfig(config));
      return {
        activePixelCount: renderState.activePixelCount,
        imageSize: config.imageSize,
        lastFrameAt: lastFrameAt?.toISOString() ?? null,
        lastSpokeAt: lastSpokeAt?.toISOString() ?? null,
        maxIntensity,
        radarBrightnessScale: config.radarBrightnessScale,
        radarRenderPalette: config.radarRenderPalette,
        renderState: spokeCount === 0 ? "empty" : "ready",
        spokeCount,
        targetFadeMs: config.radarTargetFadeMs,
        targetExpansion: config.radarTargetExpansion,
        targetMaxAgeMs: config.radarTargetMaxAgeMs,
        targetPersistenceMs: config.radarTargetPersistenceMs
      };
    },
    getLatestPng(): Buffer {
      if (applyDecay(image, returnIntensityMap, displayIntensityMap, updatedAtMap, renderState, Date.now(), getTargetDecayConfig(config))) {
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
  readonly brightnessScale: number;
  readonly fadeMs: number;
  readonly maxAgeMs: number;
  readonly palette: RadarRenderPalette;
  readonly persistenceMs: number;
  readonly targetExpansion: number;
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
  brightnessScale: config.radarBrightnessScale,
  fadeMs: config.radarTargetFadeMs,
  maxAgeMs: config.radarTargetMaxAgeMs,
  palette: config.radarRenderPalette,
  persistenceMs: config.radarTargetPersistenceMs,
  targetExpansion: config.radarTargetExpansion
});

const drawSpoke = (
  image: PNG,
  returnIntensityMap: Uint8Array,
  displayIntensityMap: Uint8Array,
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
  const footprintRadius = getFootprintRadius(image.width, decayConfig.targetExpansion);

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
    drawReturn(
      image,
      returnIntensityMap,
      displayIntensityMap,
      updatedAtMap,
      renderState,
      x,
      y,
      scaleIntensity(intensity, decayConfig.brightnessScale),
      footprintRadius,
      renderedAtMs,
      decayConfig
    );
  }
};

const getFootprintRadius = (imageSize: number, targetExpansion: number): number =>
  Math.max(1, Math.round((imageSize / 256) * (targetExpansion / 100)));

const scaleIntensity = (intensity: number, brightnessScale: number): number =>
  Math.min(255, Math.max(0, Math.round(intensity * (brightnessScale / 100))));

const drawReturn = (
  image: PNG,
  returnIntensityMap: Uint8Array,
  displayIntensityMap: Uint8Array,
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
        returnIntensityMap,
        displayIntensityMap,
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
  returnIntensityMap: Uint8Array,
  displayIntensityMap: Uint8Array,
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
  const currentIntensity = returnIntensityMap[pixelIndex] ?? 0;
  const currentDisplayIntensity = displayIntensityMap[pixelIndex] ?? 0;
  const agedIntensity = getAgedIntensity(currentIntensity, renderedAtMs - (updatedAtMap[pixelIndex] ?? 0), decayConfig);
  if (agedIntensity !== currentDisplayIntensity) {
    updateDisplayPixel(image, displayIntensityMap, renderState, pixelIndex, x, y, agedIntensity, decayConfig.palette);
  }

  if (intensity <= agedIntensity) {
    return;
  }

  updateReturnPixel(
    image,
    returnIntensityMap,
    displayIntensityMap,
    updatedAtMap,
    renderState,
    pixelIndex,
    x,
    y,
    intensity,
    renderedAtMs,
    decayConfig.palette
  );
};

const applyDecay = (
  image: PNG,
  returnIntensityMap: Uint8Array,
  displayIntensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  renderedAtMs: number,
  decayConfig: TargetDecayConfig
): boolean => {
  let changed = false;
  for (let pixelIndex = 0; pixelIndex < returnIntensityMap.length; pixelIndex += 1) {
    const currentIntensity = returnIntensityMap[pixelIndex] ?? 0;
    if (currentIntensity === 0) {
      continue;
    }

    const agedIntensity = getAgedIntensity(currentIntensity, renderedAtMs - (updatedAtMap[pixelIndex] ?? 0), decayConfig);
    if (agedIntensity === (displayIntensityMap[pixelIndex] ?? 0)) {
      continue;
    }

    updateDisplayPixel(
      image,
      displayIntensityMap,
      renderState,
      pixelIndex,
      pixelIndex % image.width,
      Math.floor(pixelIndex / image.width),
      agedIntensity,
      decayConfig.palette
    );
    if (agedIntensity === 0) {
      returnIntensityMap[pixelIndex] = 0;
      updatedAtMap[pixelIndex] = 0;
    }
    changed = true;
  }

  return changed;
};

const updateReturnPixel = (
  image: PNG,
  returnIntensityMap: Uint8Array,
  displayIntensityMap: Uint8Array,
  updatedAtMap: Float64Array,
  renderState: RenderState,
  pixelIndex: number,
  x: number,
  y: number,
  intensity: number,
  renderedAtMs: number,
  palette: RadarRenderPalette
): void => {
  returnIntensityMap[pixelIndex] = intensity;
  updatedAtMap[pixelIndex] = intensity > 0 ? renderedAtMs : 0;
  updateDisplayPixel(image, displayIntensityMap, renderState, pixelIndex, x, y, intensity, palette);
};

const updateDisplayPixel = (
  image: PNG,
  displayIntensityMap: Uint8Array,
  renderState: RenderState,
  pixelIndex: number,
  x: number,
  y: number,
  intensity: number,
  palette: RadarRenderPalette
): void => {
  const previousIntensity = displayIntensityMap[pixelIndex] ?? 0;
  if (previousIntensity === 0 && intensity > 0) {
    renderState.activePixelCount += 1;
  } else if (previousIntensity > 0 && intensity === 0) {
    renderState.activePixelCount -= 1;
  }

  displayIntensityMap[pixelIndex] = intensity;
  const offset = (y * image.width + x) * 4;
  if (intensity === 0) {
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
    image.data[offset + 3] = 255;
    return;
  }

  const color = colorizeIntensity(intensity, palette);
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

const colorizeIntensity = (
  intensity: number,
  palette: RadarRenderPalette
): { readonly blue: number; readonly green: number; readonly red: number } => {
  if (palette === "green") {
    return { blue: 0, green: intensity, red: 0 };
  }

  if (palette === "grayscale") {
    return { blue: intensity, green: intensity, red: intensity };
  }

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
