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
  calibrationCapturePacketLimit: 250,
  headless: true,
  imageSize: 16,
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
  rawRecordingDirectory: "captures/recordings",
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 3,
  targetLostTimeoutSeconds: 10,
  targetTrackingEnabled: true
};

const metadata: RadarImageMetadata = {
  activePixelCount: 4,
  imageSize: 16,
  lastFrameAt: "2026-06-07T00:00:00.000Z",
  lastSpokeAt: "2026-06-07T00:00:00.000Z",
  maxIntensity: 255,
  radarBrightnessScale: 100,
  radarRenderPalette: "chartplotter",
  renderState: "ready",
  spokeCount: 1,
  targetFadeMs: 8000,
  targetExpansion: 100,
  targetMaxAgeMs: 15000,
  targetPersistenceMs: 4000
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

    expect(replay.getMetadata()).toMatchObject({
      frameCount: 1,
      frameIntervalMs: 1000,
      newestFrameAt: "2026-06-07T00:00:00.000Z",
      oldestFrameAt: "2026-06-07T00:00:00.000Z",
      playback: {
        currentFrameAt: null,
        mode: "live",
        requestedAt: null,
        speed: 1,
        status: "live"
      },
      retentionSeconds: 3,
      totalBytes: 1
    });
    expect(replay.getMetadata().playback.updatedAt).toEqual(expect.any(String));
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

  it("lists frames by timestamp range and limit", () => {
    const { sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1));
    replay.captureFrame(frame("2026-06-07T00:00:01.000Z", 2));
    replay.captureFrame(frame("2026-06-07T00:00:02.000Z", 3));

    expect(
      replay
        .listFrames({
          from: "2026-06-07T00:00:00.500Z",
          limit: 1,
          to: "2026-06-07T00:00:02.000Z"
        })
        .map((item) => item.capturedAt)
    ).toEqual(["2026-06-07T00:00:02.000Z"]);
  });

  it("tracks replay playback state for pause, resume, jump, scrub, and live actions", () => {
    const { sink } = createMemorySink();
    const replay = createReplayBuffer({ config, logger: createLogger({ level: "debug", sink }) });

    replay.captureFrame(frame("2026-06-07T00:00:00.000Z", 1));
    replay.captureFrame(frame("2026-06-07T00:00:02.000Z", 2));

    expect(replay.updatePlayback({ action: "pause" })).toMatchObject({
      currentFrameAt: "2026-06-07T00:00:02.000Z",
      mode: "replay",
      requestedAt: null,
      speed: 1,
      status: "paused"
    });
    expect(replay.updatePlayback({ action: "resume", speed: 5 })).toMatchObject({
      currentFrameAt: "2026-06-07T00:00:02.000Z",
      mode: "replay",
      speed: 5,
      status: "playing"
    });
    expect(replay.updatePlayback({ action: "jump", at: "2026-06-07T00:00:00.200Z" })).toMatchObject({
      currentFrameAt: "2026-06-07T00:00:00.000Z",
      mode: "replay",
      requestedAt: "2026-06-07T00:00:00.200Z",
      speed: 5,
      status: "paused"
    });
    expect(replay.updatePlayback({ action: "scrub", at: "2026-06-07T00:00:01.900Z", speed: 2 })).toMatchObject({
      currentFrameAt: "2026-06-07T00:00:02.000Z",
      mode: "replay",
      requestedAt: "2026-06-07T00:00:01.900Z",
      speed: 2,
      status: "paused"
    });
    expect(replay.updatePlayback({ action: "live" })).toMatchObject({
      currentFrameAt: null,
      mode: "live",
      requestedAt: null,
      speed: 2,
      status: "live"
    });
    expect(replay.getPlaybackState().updatedAt).toEqual(expect.any(String));
  });
});
