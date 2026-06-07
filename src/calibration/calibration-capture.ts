import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
import type { RadarStatus } from "../radar/status.js";
import type { ReplayBuffer } from "../replay/replay-buffer.js";

export interface CalibrationCapture {
  captureNow(capturedAt?: Date): Promise<CalibrationCaptureResult | undefined>;
  start(): Promise<void>;
  stop(): void;
}

export interface CalibrationCaptureOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
  readonly radarStatus: () => RadarStatus;
  readonly renderer: RadarImageRenderer;
  readonly replayBuffer: ReplayBuffer;
}

export interface CalibrationCaptureResult {
  readonly capturedAt: string;
  readonly directory: string;
  readonly files: readonly string[];
}

export const createCalibrationCapture = ({
  config,
  logger,
  radarStatus,
  renderer,
  replayBuffer
}: CalibrationCaptureOptions): CalibrationCapture => {
  let interval: NodeJS.Timeout | undefined;

  const captureNow = async (capturedAt = new Date()): Promise<CalibrationCaptureResult | undefined> => {
    if (!config.calibrationCaptureEnabled) {
      return undefined;
    }

    const captureDirectory = join(config.calibrationCaptureDirectory, formatCaptureTimestamp(capturedAt));
    await mkdir(captureDirectory, { recursive: true });

    const status = radarStatus();
    const latestMetadata = renderer.getLatestMetadata();
    const replayMetadata = replayBuffer.getMetadata();
    const replayFrames = replayBuffer.listFrames();
    const latestPng = renderer.getLatestPng();
    const manifest = {
      capturedAt: capturedAt.toISOString(),
      files: {
        latestMetadata: "latest.json",
        latestPng: "latest.png",
        manifest: "manifest.json",
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
      writeJson(join(captureDirectory, "replay.json"), replayMetadata),
      writeJson(join(captureDirectory, "replay-frames.json"), { frames: replayFrames }),
      writeJson(join(captureDirectory, "status.json"), status)
    ]);

    const result = {
      capturedAt: capturedAt.toISOString(),
      directory: captureDirectory,
      files: Object.values(manifest.files)
    };
    logger.info(`calibration capture written directory=${captureDirectory}`);
    return result;
  };

  return {
    captureNow,
    async start(): Promise<void> {
      if (!config.calibrationCaptureEnabled) {
        logger.debug("calibration capture start skipped; disabled by configuration");
        return;
      }

      if (interval) {
        logger.debug("calibration capture start skipped; already running");
        return;
      }

      await mkdir(config.calibrationCaptureDirectory, { recursive: true });
      logger.info(
        `calibration capture enabled directory=${config.calibrationCaptureDirectory} intervalMs=${config.calibrationCaptureIntervalMs}`
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

const formatCaptureTimestamp = (date: Date): string => {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
};
