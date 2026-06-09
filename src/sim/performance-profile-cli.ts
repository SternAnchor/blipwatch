import { performance } from "node:perf_hooks";

import type { BlipWatchConfig } from "../config/config.js";
import { createLogger, type LogSink } from "../logging/logger.js";
import type { RadarSpoke } from "../radar/decoder.js";
import { createRadarImageRenderer } from "../radar/renderer.js";
import { createReplayBuffer } from "../replay/replay-buffer.js";

interface ProfileOptions {
  readonly captureEvery: number;
  readonly imageSize: number;
  readonly rangeMeters: number;
  readonly sampleCount: number;
  readonly spokes: number;
}

const loadProfileOptions = (env: NodeJS.ProcessEnv): ProfileOptions => ({
  captureEvery: parsePositiveInteger(env.PROFILE_CAPTURE_EVERY, 16),
  imageSize: parsePositiveInteger(env.PROFILE_IMAGE_SIZE, 1024),
  rangeMeters: parsePositiveInteger(env.PROFILE_RANGE_METERS, 2000),
  sampleCount: parsePositiveInteger(env.PROFILE_SAMPLE_COUNT, 512),
  spokes: parsePositiveInteger(env.PROFILE_SPOKES, 4096)
});

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}"`);
  }

  return parsed;
};

const silentSink: LogSink = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {}
};

const createProfileConfig = (options: ProfileOptions): BlipWatchConfig => ({
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
  calibrationCaptureIntervalMs: 10000,
  calibrationCapturePacketLimit: 250,
  headless: true,
  imageSize: options.imageSize,
  logLevel: "info",
  openBrowser: false,
  port: 0,
  portFallbackEnabled: true,
  portFallbackMaxAttempts: 5,
  radarBrightnessScale: 100,
  radarControlEnabled: false,
  radarControlFallbackHost: "236.6.8.36",
  radarControlHost: "auto",
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
  radarReportUdpPort: 6878,
  radarRenderPalette: "chartplotter",
  radarTargetExpansion: 100,
  radarTargetFadeMs: 8000,
  radarTargetMaxAgeMs: 15000,
  radarTargetPersistenceMs: 4000,
  radarUdpPort: 6678,
  rawRecordingDirectory: "captures/recordings",
  replayFrameIntervalMs: 1,
  replayRetentionSeconds: 300,
  targetLostTimeoutSeconds: 10,
  targetTrackingEnabled: false
});

const createSyntheticSpoke = (index: number, options: ProfileOptions): RadarSpoke => {
  const intensities = new Uint8Array(options.sampleCount);
  for (let sample = 0; sample < intensities.length; sample += 1) {
    const targetBand = (sample + index) % 97;
    intensities[sample] = targetBand < 4 ? 220 : targetBand < 8 ? 96 : 0;
  }

  return {
    angleDegrees: (index * 360) / Math.max(options.spokes, 1),
    intensities,
    maxIntensity: 220,
    rangeMeters: options.rangeMeters,
    receivedAt: new Date(1_780_000_000_000 + index),
    sampleCount: options.sampleCount,
    type: "spoke"
  };
};

const profile = (): void => {
  const options = loadProfileOptions(process.env);
  const config = createProfileConfig(options);
  const logger = createLogger({ level: "info", sink: silentSink });
  const renderer = createRadarImageRenderer({ config, logger });
  const replay = createReplayBuffer({ config, logger });
  const startedMemory = process.memoryUsage();
  const startedAt = performance.now();
  let capturedFrames = 0;

  for (let index = 0; index < options.spokes; index += 1) {
    renderer.applySpoke(createSyntheticSpoke(index, options));
    if (index % options.captureEvery === 0) {
      const captured = replay.captureFrame({
        capturedAt: new Date(1_780_000_000_000 + index),
        metadata: renderer.getLatestMetadata(),
        png: renderer.getLatestPng()
      });
      capturedFrames += captured ? 1 : 0;
    }
  }

  const durationMs = performance.now() - startedAt;
  const finishedMemory = process.memoryUsage();
  const replayMetadata = replay.getMetadata();

  console.info(
    JSON.stringify(
      {
        capturedFrames,
        durationMs: Math.round(durationMs),
        imageSize: options.imageSize,
        memoryDeltaBytes: {
          arrayBuffers: finishedMemory.arrayBuffers - startedMemory.arrayBuffers,
          external: finishedMemory.external - startedMemory.external,
          heapUsed: finishedMemory.heapUsed - startedMemory.heapUsed,
          rss: finishedMemory.rss - startedMemory.rss
        },
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        replayTotalBytes: replayMetadata.totalBytes,
        sampleCount: options.sampleCount,
        spokes: options.spokes,
        spokesPerSecond: Math.round(options.spokes / (durationMs / 1000))
      },
      null,
      2
    )
  );
};

try {
  profile();
} catch (error) {
  console.error("radar profile failed", error);
  process.exitCode = 1;
}
