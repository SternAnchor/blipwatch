import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCalibrationCapture } from "../src/calibration/calibration-capture.js";
import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import type { RadarImageRenderer } from "../src/radar/renderer.js";
import type { RadarStatus } from "../src/radar/status.js";
import type { ReplayBuffer } from "../src/replay/replay-buffer.js";
import { createMemorySink } from "./support/logger.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const playbackState = {
  currentFrameAt: null,
  mode: "live" as const,
  requestedAt: null,
  speed: 1 as const,
  status: "live" as const,
  updatedAt: "2026-06-07T00:00:00.000Z"
};
let temporaryDirectories: string[] = [];

const config = (directory: string, enabled = true): BlipWatchConfig => ({
  calibrationCaptureDirectory: directory,
  calibrationCaptureEnabled: enabled,
  calibrationCaptureIntervalMs: 10000,
  calibrationCapturePacketLimit: 250,
  headless: true,
  imageSize: 32,
  logLevel: "debug",
  openBrowser: false,
  port: 0,
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
  replayRetentionSeconds: 300,
  targetLostTimeoutSeconds: 10,
  targetTrackingEnabled: true
});

const renderer: RadarImageRenderer = {
  applySpoke(): void {},
  clear(): void {},
  getLatestMetadata() {
    return {
      activePixelCount: 10,
      imageSize: 32,
      lastFrameAt: "2026-06-07T00:00:00.000Z",
      lastSpokeAt: "2026-06-07T00:00:00.000Z",
      maxIntensity: 255,
      radarBrightnessScale: 100,
      radarRenderPalette: "chartplotter",
      renderState: "ready",
      spokeCount: 12,
      targetFadeMs: 8000,
      targetExpansion: 100,
      targetMaxAgeMs: 15000,
      targetPersistenceMs: 4000
    };
  },
  getLatestPng() {
    return png;
  },
  imageSize: 32
};

const replayBuffer: ReplayBuffer = {
  captureFrame() {
    return undefined;
  },
  frameIntervalMs: 1000,
  getFrameAt() {
    return undefined;
  },
  getMetadata() {
    return {
      frameCount: 1,
      frameIntervalMs: 1000,
      newestFrameAt: "2026-06-07T00:00:00.000Z",
      oldestFrameAt: "2026-06-07T00:00:00.000Z",
      playback: playbackState,
      retentionSeconds: 300,
      totalBytes: png.byteLength
    };
  },
  getPlaybackState() {
    return playbackState;
  },
  listFrames() {
    return [
      {
        capturedAt: "2026-06-07T00:00:00.000Z",
        metadata: renderer.getLatestMetadata(),
        sizeBytes: png.byteLength
      }
    ];
  },
  retentionSeconds: 300,
  updatePlayback() {
    return playbackState;
  }
};

const radarStatus = (): RadarStatus =>
  ({
    diagnostics: {
      nextActions: [],
      phase: "receiving-and-rendering",
      summary: "Radar spokes are decoding and rendering."
    },
    renderer: {
      imageAvailable: true,
      imageSize: 32,
      lastRenderedImageAt: "2026-06-07T00:00:00.000Z",
      lastSpokeAt: "2026-06-07T00:00:00.000Z",
      renderState: "ready",
      spokeCount: 12
    }
  }) as unknown as RadarStatus;

describe("createCalibrationCapture", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })));
    temporaryDirectories = [];
  });

  it("skips captures when disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blipwatch-calibration-disabled-"));
    temporaryDirectories.push(directory);
    const { sink } = createMemorySink();
    const capture = createCalibrationCapture({
      config: config(directory, false),
      logger: createLogger({ level: "debug", sink }),
      radarStatus,
      renderer,
      replayBuffer
    });

    await expect(capture.captureNow(new Date("2026-06-07T00:00:00.000Z"))).resolves.toBeUndefined();
  });

  it("writes timestamped calibration bundles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blipwatch-calibration-"));
    temporaryDirectories.push(directory);
    const { sink } = createMemorySink();
    const capture = createCalibrationCapture({
      config: config(directory),
      logger: createLogger({ level: "debug", sink }),
      packetSnapshot: () => [
        {
          delayMs: 0,
          payloadHex: "42575331",
          receivedAt: "2026-06-07T00:00:00.000Z",
          remoteAddress: "192.0.2.10",
          remotePort: 6678,
          size: 4
        }
      ],
      radarStatus,
      renderer,
      replayBuffer
    });

    const result = await capture.captureNow(new Date("2026-06-07T00:00:00.000Z"));
    if (!result) {
      throw new Error("calibration capture did not produce a bundle");
    }

    expect(result).toMatchObject({
      capturedAt: "2026-06-07T00:00:00.000Z",
      files: [
        "latest.json",
        "latest.png",
        "manifest.json",
        "packets.ndjson",
        "replay-frames.json",
        "replay.json",
        "status.json"
      ]
    });
    expect((await readdir(result.directory)).toSorted()).toEqual([
      "latest.json",
      "latest.png",
      "manifest.json",
      "packets.ndjson",
      "replay-frames.json",
      "replay.json",
      "status.json"
    ]);
    await expect(readFile(join(result.directory, "latest.png"))).resolves.toEqual(png);
    await expect(readJson(join(result.directory, "latest.json"))).resolves.toMatchObject({
      renderState: "ready",
      spokeCount: 12
    });
    await expect(readJson(join(result.directory, "status.json"))).resolves.toMatchObject({
      diagnostics: {
        phase: "receiving-and-rendering"
      }
    });
    await expect(readFile(join(result.directory, "packets.ndjson"), "utf8")).resolves.toContain(
      '"payloadHex":"42575331"'
    );
  });

  it("creates the output directory and captures immediately on startup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blipwatch-calibration-start-"));
    temporaryDirectories.push(directory);
    await rm(directory, { force: true, recursive: true });
    const { sink } = createMemorySink();
    const capture = createCalibrationCapture({
      config: config(directory),
      logger: createLogger({ level: "debug", sink }),
      radarStatus,
      renderer,
      replayBuffer
    });

    await capture.start();
    const status = capture.getStatus();
    expect(status).toMatchObject({
      enabled: true,
      running: true
    });
    expect(typeof status.lastCaptureAt).toBe("string");
    expect(typeof status.lastCaptureDirectory).toBe("string");
    capture.stop();

    const bundles = await readdir(directory);
    expect(bundles).toHaveLength(1);
  });

  it("exposes resolved output directories in status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blipwatch-calibration-status-"));
    temporaryDirectories.push(directory);
    const { sink } = createMemorySink();
    const capture = createCalibrationCapture({
      config: config(directory),
      logger: createLogger({ level: "debug", sink }),
      radarStatus,
      renderer,
      replayBuffer
    });

    expect(capture.getStatus()).toMatchObject({
      directory,
      enabled: true,
      lastCaptureAt: null,
      lastCaptureDirectory: null,
      resolvedDirectory: resolve(directory),
      running: false
    });
  });
});

const readJson = async (path: string): Promise<unknown> => {
  return JSON.parse(await readFile(path, "utf8"));
};
