import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import type { RadarSpoke } from "../src/radar/decoder.js";
import { createRadarImageRenderer } from "../src/radar/renderer.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  imageSize: 32,
  logLevel: "debug",
  port: 8080,
  radarDiscoveryEnabled: false,
  radarInterface: "127.0.0.1",
  radarMulticastGroups: [],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 0,
  radarUdpPort: 0,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300
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
  it("produces an empty PNG and metadata before any radar data arrives", () => {
    const { sink } = createMemorySink();
    const renderer = createRadarImageRenderer({ config, logger: createLogger({ level: "debug", sink }) });

    const png = PNG.sync.read(renderer.getLatestPng());

    expect(png.width).toBe(32);
    expect(png.height).toBe(32);
    expect(renderer.getLatestMetadata()).toEqual({
      imageSize: 32,
      lastFrameAt: null,
      lastSpokeAt: null,
      maxIntensity: 0,
      renderState: "empty",
      spokeCount: 0
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
    expect(readPixel(png, 31, 16)).toEqual([0, 255, 0, 255]);
    expect(messages.some((message) => message.includes("radar spoke rendered angle=90"))).toBe(true);
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
    expect(readPixel(png, 31, 16)).toEqual([0, 255, 0, 255]);
    expect(renderer.getLatestMetadata()).toMatchObject({
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
    });
  });
});
