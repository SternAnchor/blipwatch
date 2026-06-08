import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
import type { RadarStatus } from "../radar/status.js";
import type { ReplayBuffer } from "../replay/replay-buffer.js";

export interface CalibrationCapture {
  captureNow(capturedAt?: Date): Promise<CalibrationCaptureResult | undefined>;
  getStatus(): CalibrationCaptureStatus;
  start(): Promise<void>;
  stop(): void;
}

export interface CalibrationCaptureOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
  readonly packetSnapshot?: () => readonly CalibrationPacketSnapshot[];
  readonly radarStatus: () => RadarStatus;
  readonly renderer: RadarImageRenderer;
  readonly replayBuffer: ReplayBuffer;
}

export interface CalibrationPacketSnapshot {
  readonly delayMs: number;
  readonly payloadHex: string;
  readonly receivedAt: string;
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly size: number;
}

export interface CalibrationCaptureResult {
  readonly capturedAt: string;
  readonly directory: string;
  readonly files: readonly string[];
}

export interface CalibrationCaptureStatus {
  readonly directory: string;
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly lastCaptureAt: string | null;
  readonly lastCaptureDirectory: string | null;
  readonly resolvedDirectory: string;
  readonly running: boolean;
}

export const createCalibrationCapture = ({
  config,
  logger,
  packetSnapshot,
  radarStatus,
  renderer,
  replayBuffer
}: CalibrationCaptureOptions): CalibrationCapture => {
  let interval: NodeJS.Timeout | undefined;
  let lastCaptureAt: string | undefined;
  let lastCaptureDirectory: string | undefined;
  const resolvedDirectory = resolve(config.calibrationCaptureDirectory);

  const captureNow = async (capturedAt = new Date()): Promise<CalibrationCaptureResult | undefined> => {
    if (!config.calibrationCaptureEnabled) {
      return undefined;
    }

    const captureDirectory = join(resolvedDirectory, formatCaptureTimestamp(capturedAt));
    await mkdir(captureDirectory, { recursive: true });

    const status = radarStatus();
    const latestMetadata = renderer.getLatestMetadata();
    const replayMetadata = replayBuffer.getMetadata();
    const replayFrames = replayBuffer.listFrames();
    const packetSnapshots = packetSnapshot?.() ?? [];
    const latestPng = renderer.getLatestPng();
    const manifest = {
      capturedAt: capturedAt.toISOString(),
      files: {
        latestMetadata: "latest.json",
        latestPng: "latest.png",
        manifest: "manifest.json",
        rawPackets: "packets.ndjson",
        replayFrames: "replay-frames.json",
        replayMetadata: "replay.json",
        status: "status.json"
      },
      notes: [
        "Pair this bundle with a chartplotter screenshot or photo captured at the same time.",
        "Review before sharing publicly; radar imagery and network metadata may reveal location or vessel details."
      ]
    };

    await Promise.all([
      writeJson(join(captureDirectory, "latest.json"), latestMetadata),
      writeFile(join(captureDirectory, "latest.png"), latestPng),
      writeJson(join(captureDirectory, "manifest.json"), manifest),
      writeNdjson(join(captureDirectory, "packets.ndjson"), packetSnapshots),
      writeJson(join(captureDirectory, "replay.json"), replayMetadata),
      writeJson(join(captureDirectory, "replay-frames.json"), { frames: replayFrames }),
      writeJson(join(captureDirectory, "status.json"), status)
    ]);

    const result = {
      capturedAt: capturedAt.toISOString(),
      directory: captureDirectory,
      files: Object.values(manifest.files)
    };
    lastCaptureAt = result.capturedAt;
    lastCaptureDirectory = resolve(captureDirectory);
    logger.info(`calibration capture written directory=${lastCaptureDirectory}`);
    return result;
  };

  return {
    captureNow,
    getStatus(): CalibrationCaptureStatus {
      return {
        directory: config.calibrationCaptureDirectory,
        enabled: config.calibrationCaptureEnabled,
        intervalMs: config.calibrationCaptureIntervalMs,
        lastCaptureAt: lastCaptureAt ?? null,
        lastCaptureDirectory: lastCaptureDirectory ?? null,
        resolvedDirectory,
        running: interval !== undefined
      };
    },
    async start(): Promise<void> {
      if (!config.calibrationCaptureEnabled) {
        logger.debug("calibration capture start skipped; disabled by configuration");
        return;
      }

      if (interval) {
        logger.debug("calibration capture start skipped; already running");
        return;
      }

      await mkdir(resolvedDirectory, { recursive: true });
      logger.info(
        `calibration capture enabled directory=${config.calibrationCaptureDirectory} resolvedDirectory=${resolvedDirectory} intervalMs=${config.calibrationCaptureIntervalMs}`
      );
      await captureNow();
      interval = setInterval(() => {
        void captureNow().catch((error) => {
          logger.error("calibration capture failed", error);
        });
      }, config.calibrationCaptureIntervalMs);
    },
    stop(): void {
      if (!interval) {
        return;
      }

      clearInterval(interval);
      interval = undefined;
      logger.debug("calibration capture stopped");
    }
  };
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeNdjson = async (path: string, values: readonly unknown[]): Promise<void> => {
  await writeFile(path, values.map((value) => JSON.stringify(value)).join("\n") + (values.length > 0 ? "\n" : ""));
};

const formatCaptureTimestamp = (date: Date): string => {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
};
