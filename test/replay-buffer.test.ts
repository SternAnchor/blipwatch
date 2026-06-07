import { describe, expect, it } from "vitest";

import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import type { RadarImageMetadata } from "../src/radar/renderer.js";
import { createReplayBuffer } from "../src/replay/replay-buffer.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
  calibrationCaptureIntervalMs: 10000,
  imageSize: 16,
  logLevel: "debug",
  port: 8080,
  radarControlEnabled: false,
  radarControlFallbackHost: "236.6.8.36",
  radarControlHost: "236.6.8.36",
  radarControlMode: "wake",
  radarControlPort: 6516,
  radarControlStayAliveIntervalMs: 1000,
  radarControlWakeHost: "236.6.7.5",
  radarControlWakePort: 6878,
  radarDiscoveryEnabled: false,
  radarInterface: "127.0.0.1",
  radarMulticastGroups: [],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 0,
  radarUdpPort: 0,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 3
};

const metadata: RadarImageMetadata = {
  imageSize: 16,
  lastFrameAt: "2026-06-07T00:00:00.000Z",
  lastSpokeAt: "2026-06-07T00:00:00.000Z",
  maxIntensity: 255,
  renderState: "ready",
  spokeCount: 1
};

const frame = (isoTimestamp: string, value: number) => ({
  capturedAt: new Date(isoTimestamp),
  metadata: { ...metadata, lastFrameAt: isoTimestamp },
  png: Buffer.from([value])
});

describe("createReplayBuffer", () => {
  it("captures frames and exposes replay metadata", () => {
    const { messages, sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1));

    expect(replay.getMetadata()).toEqual({
      frameCount: 1,
      frameIntervalMs: 1000,
      newestFrameAt: "2026-06-07T00:00:00.000Z",
      oldestFrameAt: "2026-06-07T00:00:00.000Z",
      retentionSeconds: 3
    });
    expect(replay.listFrames()).toEqual([
      {
        capturedAt: "2026-06-07T00:00:00.000Z",
        metadata,
        sizeBytes: 1
      }
    ]);
    expect(messages.some((message) => message.includes("replay frame captured"))).toBe(true);
  });

  it("samples frames based on the configured frame interval", () => {
    const { messages, sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    expect(replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1))).toBeDefined();
    expect(replay.captureFrame(frame("2026-06-07T00:00:00.500Z", 2))).toBeUndefined();
    expect(replay.captureFrame(frame("2026-06-07T00:00:01.000Z", 3))).toBeDefined();

    expect(replay.listFrames()).toHaveLength(2);
    expect(messages.some((message) => message.includes("replay frame skipped by interval"))).toBe(true);
  });

  it("evicts frames older than retention", () => {
    const { sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1));
    replay.captureFrame(frame("2026-06-07T00:00:01.000Z", 2));
    replay.captureFrame(frame("2026-06-07T00:00:04.000Z", 3));

    expect(replay.listFrames().map((item) => item.capturedAt)).toEqual([
      "2026-06-07T00:00:01.000Z",
      "2026-06-07T00:00:04.000Z"
    ]);
  });

  it("evicts multiple expired frames in one trim pass", () => {
    const { sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1));
    replay.captureFrame(frame("2026-06-07T00:00:01.000Z", 2));
    replay.captureFrame(frame("2026-06-07T00:00:02.000Z", 3));
    replay.captureFrame(frame("2026-06-07T00:00:06.000Z", 4));

    expect(replay.listFrames().map((item) => item.capturedAt)).toEqual(["2026-06-07T00:00:06.000Z"]);
  });

  it("returns the closest frame for timestamp lookup", () => {
    const { sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1));
    replay.captureFrame(frame("2026-06-07T00:00:02.000Z", 2));

    expect(replay.getFrameAt("2026-06-07T00:00:01.700Z")?.capturedAt.toISOString()).toBe(
      "2026-06-07T00:00:02.000Z"
    );
    expect(replay.getFrameAt("not-a-date")).toBeUndefined();
  });
});
