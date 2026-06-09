import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import type { RadarSpoke } from "../src/radar/decoder.js";
import { createRadarImageRenderer } from "../src/radar/renderer.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
  calibrationCaptureIntervalMs: 10000,
  calibrationCapturePacketLimit: 250,
  headless: true,
  imageSize: 32,
  logLevel: "debug",
  openBrowser: false,
  port: 8080,
  portFallbackEnabled: true,
  portFallbackMaxAttempts: 5,
  radarBrightnessScale: 100,
  radarControlEnabled: false,
  radarControlFallbackHost: "236.6.8.36",
  radarControlHost: "236.6.8.36",
  radarControlMode: "wake",
  radarControlPort: 6516,
  radarControlStayAliveIntervalMs: 1000,
  radarControlWakeHost: "236.6.7.5",
  radarControlWakePort: 6878,
  radarDiscoveryEnabled: false,
  radarDisplayRangeMeters: "auto",
  radarInterface: "127.0.0.1",
  radarMulticastGroups: [],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 0,
  radarRenderPalette: "chartplotter",
  radarTargetFadeMs: 8000,
  radarTargetExpansion: 100,
  radarTargetMaxAgeMs: 15000,
  radarTargetPersistenceMs: 4000,
  radarUdpPort: 0,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300,
  targetLostTimeoutSeconds: 10,
  targetTrackingEnabled: true
};

const readPixel = (image: PNG, x: number, y: number): [number, number, number, number] => {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 0
  ];
};

describe("createRadarImageRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces an empty PNG and metadata before any radar data arrives", () => {
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({ config, logger: createLogger({ level: "debug", sink }) });

    const png = PNG.sync.read(renderer.getLatestPng());

    expect(png.width).toBe(32);
    expect(png.height).toBe(32);
    expect(renderer.getLatestMetadata()).toEqual({
      activePixelCount: 0,
      imageSize: 32,
      lastFrameAt: null,
      lastSpokeAt: null,
      maxIntensity: 0,
      radarBrightnessScale: 100,
      radarRenderPalette: "chartplotter",
      renderState: "empty",
      spokeCount: 0,
      targetFadeMs: 8000,
      targetExpansion: 100,
      targetMaxAgeMs: 15000,
      targetPersistenceMs: 4000
    });
  });

  it("renders a normalized spoke into the current image", () => {
    const { messages, sink } = createMemorySink();
    const renderer = createRadarImageRenderer({ config, logger: createLogger({ level: "debug", sink }) });
    const receivedAt = new Date("2026-06-07T00:00:00.000Z");
    const spoke: RadarSpoke = {
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 64, 128, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt,
      sampleCount: 4,
      type: "spoke"
    };

    renderer.applySpoke(spoke);

    const metadata = renderer.getLatestMetadata();
    expect(metadata.renderState).toBe("ready");
    expect(metadata.lastSpokeAt).toBe(receivedAt.toISOString());
    expect(metadata.maxIntensity).toBe(255);
    expect(metadata.spokeCount).toBe(1);

    const png = PNG.sync.read(renderer.getLatestPng());
    expect(readPixel(png, 31, 16)).toEqual([255, 96, 48, 255]);
    expect(readPixel(png, 30, 16)).not.toEqual([0, 0, 0, 255]);
    expect(messages.some((message) => message.includes("radar spoke rendered angle=90"))).toBe(true);
  });

  it("clears rendered reflections and resets image metadata", () => {
    const { messages, sink } = createMemorySink();
    const renderer = createRadarImageRenderer({ config, logger: createLogger({ level: "debug", sink }) });

    renderer.applySpoke({
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 64, 128, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt: new Date("2026-06-07T00:00:00.000Z"),
      sampleCount: 4,
      type: "spoke"
    });

    const renderedMetadata = renderer.getLatestMetadata();
    expect(renderedMetadata.activePixelCount).toBeGreaterThan(0);
    expect(renderedMetadata).toMatchObject({
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
    });

    vi.setSystemTime(new Date("2026-06-07T00:00:05.000Z"));
    renderer.clear();

    expect(renderer.getLatestMetadata()).toMatchObject({
      activePixelCount: 0,
      lastFrameAt: "2026-06-07T00:00:05.000Z",
      lastSpokeAt: null,
      maxIntensity: 0,
      renderState: "empty",
      spokeCount: 0
    });
    const png = PNG.sync.read(renderer.getLatestPng());
    expect(readPixel(png, 31, 16)).toEqual([0, 0, 0, 255]);
    expect(messages.some((message) => message.includes("radar renderer cleared"))).toBe(true);
  });

  it("caches encoded PNG output until the rendered image changes", () => {
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({ config, logger: createLogger({ level: "debug", sink }) });

    const emptyPng = renderer.getLatestPng();
    expect(renderer.getLatestPng()).toBe(emptyPng);

    renderer.applySpoke({
      angleDegrees: 180,
      intensities: Uint8Array.from([0, 128, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt: new Date("2026-06-07T00:00:00.000Z"),
      sampleCount: 3,
      type: "spoke"
    });

    const renderedPng = renderer.getLatestPng();
    expect(renderedPng).not.toBe(emptyPng);
    expect(renderer.getLatestPng()).toBe(renderedPng);
  });

  it("renders high-density HALO spokes without exceeding image bounds", () => {
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({ config, logger: createLogger({ level: "debug", sink }) });
    const intensities = new Uint8Array(1024);
    intensities[1023] = 255;

    renderer.applySpoke({
      angleDegrees: 90,
      intensities,
      maxIntensity: 255,
      rangeMeters: 2000,
      receivedAt: new Date("2026-06-07T00:00:00.000Z"),
      sampleCount: intensities.length,
      type: "spoke"
    });

    const png = PNG.sync.read(renderer.getLatestPng());
    expect(readPixel(png, 31, 16)).toEqual([255, 96, 48, 255]);
    expect(readPixel(png, 30, 16)).not.toEqual([0, 0, 0, 255]);
    expect(renderer.getLatestMetadata()).toMatchObject({
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
    });
  });

  it("clips and scales spokes to the configured display range", () => {
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({
      config: { ...config, radarDisplayRangeMeters: 1000 },
      logger: createLogger({ level: "debug", sink })
    });

    renderer.applySpoke({
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 255, 255]),
      maxIntensity: 255,
      rangeMeters: 2000,
      receivedAt: new Date("2026-06-07T00:00:00.000Z"),
      sampleCount: 3,
      type: "spoke"
    });

    const png = PNG.sync.read(renderer.getLatestPng());
    expect(readPixel(png, 31, 16)).toEqual([255, 96, 48, 255]);
    expect(readPixel(png, 24, 16)).toEqual([0, 0, 0, 255]);
  });

  it("uses configurable render palettes", () => {
    const { sink } = createMemorySink();
    const greenRenderer = createRadarImageRenderer({
      config: { ...config, radarRenderPalette: "green" },
      logger: createLogger({ level: "debug", sink })
    });
    const grayscaleRenderer = createRadarImageRenderer({
      config: { ...config, radarRenderPalette: "grayscale" },
      logger: createLogger({ level: "debug", sink })
    });
    const spoke: RadarSpoke = {
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt: new Date("2026-06-07T00:00:00.000Z"),
      sampleCount: 2,
      type: "spoke"
    };

    greenRenderer.applySpoke(spoke);
    grayscaleRenderer.applySpoke(spoke);

    expect(readPixel(PNG.sync.read(greenRenderer.getLatestPng()), 31, 16)).toEqual([0, 255, 0, 255]);
    expect(readPixel(PNG.sync.read(grayscaleRenderer.getLatestPng()), 31, 16)).toEqual([255, 255, 255, 255]);
    expect(greenRenderer.getLatestMetadata()).toMatchObject({
      radarRenderPalette: "green"
    });
  });

  it("scales target brightness and expansion", () => {
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({
      config: {
        ...config,
        radarBrightnessScale: 50,
        radarTargetExpansion: 200
      },
      logger: createLogger({ level: "debug", sink })
    });

    renderer.applySpoke({
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt: new Date("2026-06-07T00:00:00.000Z"),
      sampleCount: 2,
      type: "spoke"
    });

    const png = PNG.sync.read(renderer.getLatestPng());
    expect(readPixel(png, 31, 16)).toEqual([255, 176, 32, 255]);
    expect(readPixel(png, 30, 16)).not.toEqual([0, 0, 0, 255]);
    expect(renderer.getLatestMetadata()).toMatchObject({
      radarBrightnessScale: 50,
      targetExpansion: 200
    });
  });

  it("ages radar returns through persistence, fade, and maximum age", () => {
    const startedAt = new Date("2026-06-07T00:00:00.000Z");
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({
      config: {
        ...config,
        radarTargetFadeMs: 1000,
        radarTargetMaxAgeMs: 3000,
        radarTargetPersistenceMs: 1000
      },
      logger: createLogger({ level: "debug", sink })
    });

    renderer.applySpoke({
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt: startedAt,
      sampleCount: 2,
      type: "spoke"
    });

    expect(PNG.sync.read(renderer.getLatestPng()).data[(16 * 32 + 31) * 4]).toBe(255);
    expect(renderer.getLatestMetadata().activePixelCount).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-06-07T00:00:01.500Z"));
    const fadingPixel = readPixel(PNG.sync.read(renderer.getLatestPng()), 31, 16);
    expect(fadingPixel).not.toEqual([255, 96, 48, 255]);
    expect(fadingPixel).not.toEqual([0, 0, 0, 255]);

    vi.setSystemTime(new Date("2026-06-07T00:00:03.000Z"));
    const agedOut = PNG.sync.read(renderer.getLatestPng());
    expect(readPixel(agedOut, 31, 16)).toEqual([0, 0, 0, 255]);
    expect(renderer.getLatestMetadata().activePixelCount).toBe(0);
  });

  it("does not compound decay across repeated image reads", () => {
    const startedAt = new Date("2026-06-07T00:00:00.000Z");
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({
      config: {
        ...config,
        radarTargetFadeMs: 1000,
        radarTargetMaxAgeMs: 3000,
        radarTargetPersistenceMs: 1000
      },
      logger: createLogger({ level: "debug", sink })
    });

    renderer.applySpoke({
      angleDegrees: 90,
      intensities: Uint8Array.from([0, 255]),
      maxIntensity: 255,
      rangeMeters: 1000,
      receivedAt: startedAt,
      sampleCount: 2,
      type: "spoke"
    });

    vi.setSystemTime(new Date("2026-06-07T00:00:01.500Z"));
    const firstRead = readPixel(PNG.sync.read(renderer.getLatestPng()), 31, 16);
    const secondRead = readPixel(PNG.sync.read(renderer.getLatestPng()), 31, 16);

    expect(secondRead).toEqual(firstRead);
    expect(firstRead).toEqual([255, 176, 32, 255]);
  });
});
