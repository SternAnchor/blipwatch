import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageMetadata } from "../radar/renderer.js";

export interface ReplayBuffer {
  readonly frameIntervalMs: number;
  readonly retentionSeconds: number;
  captureFrame(frame: ReplayFrameInput): ReplayFrame | undefined;
  getFrameAt(timestamp: Date | string): ReplayFrame | undefined;
  getMetadata(): ReplayMetadata;
  listFrames(): ReplayFrameMetadata[];
}

interface ReplayBufferOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

export interface ReplayFrameInput {
  readonly capturedAt?: Date;
  readonly metadata: RadarImageMetadata;
  readonly png: Buffer;
}

export interface ReplayFrame {
  readonly capturedAt: Date;
  readonly metadata: RadarImageMetadata;
  readonly png: Buffer;
}

export interface ReplayFrameMetadata {
  readonly capturedAt: string;
  readonly metadata: RadarImageMetadata;
  readonly sizeBytes: number;
}

export interface ReplayMetadata {
  readonly frameCount: number;
  readonly frameIntervalMs: number;
  readonly newestFrameAt: string | null;
  readonly oldestFrameAt: string | null;
  readonly retentionSeconds: number;
}

export const createReplayBuffer = ({ config, logger }: ReplayBufferOptions): ReplayBuffer => {
  const frames: ReplayFrame[] = [];
  let lastCapturedAt: Date | undefined;

  logger.debug(
    `replay buffer initialized for ${config.replayRetentionSeconds}s at ${config.replayFrameIntervalMs}ms intervals`
  );

  return {
    captureFrame(frame: ReplayFrameInput): ReplayFrame | undefined {
      const capturedAt = frame.capturedAt ?? new Date();

      if (lastCapturedAt && capturedAt.getTime() - lastCapturedAt.getTime() < config.replayFrameIntervalMs) {
        logger.debug(
          `replay frame skipped by interval capturedAt=${capturedAt.toISOString()} lastCapturedAt=${lastCapturedAt.toISOString()}`
        );
        return undefined;
      }

      const replayFrame: ReplayFrame = {
        capturedAt,
        metadata: frame.metadata,
        png: Buffer.from(frame.png)
      };

      frames.push(replayFrame);
      lastCapturedAt = capturedAt;
      trimFrames(frames, capturedAt, config.replayRetentionSeconds);
      logger.debug(`replay frame captured at=${capturedAt.toISOString()} frameCount=${frames.length}`);

      return replayFrame;
    },
    frameIntervalMs: config.replayFrameIntervalMs,
    getFrameAt(timestamp: Date | string): ReplayFrame | undefined {
      const target = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
      if (Number.isNaN(target.getTime()) || frames.length === 0) {
        return undefined;
      }

      return frames.reduce((closest, candidate) => {
        const closestDistance = Math.abs(closest.capturedAt.getTime() - target.getTime());
        const candidateDistance = Math.abs(candidate.capturedAt.getTime() - target.getTime());
        return candidateDistance < closestDistance ? candidate : closest;
      });
    },
    getMetadata(): ReplayMetadata {
      return {
        frameCount: frames.length,
        frameIntervalMs: config.replayFrameIntervalMs,
        newestFrameAt: frames.at(-1)?.capturedAt.toISOString() ?? null,
        oldestFrameAt: frames[0]?.capturedAt.toISOString() ?? null,
        retentionSeconds: config.replayRetentionSeconds
      };
    },
    listFrames(): ReplayFrameMetadata[] {
      return frames.map((frame) => ({
        capturedAt: frame.capturedAt.toISOString(),
        metadata: frame.metadata,
        sizeBytes: frame.png.byteLength
      }));
    },
    retentionSeconds: config.replayRetentionSeconds
  };
};

const trimFrames = (frames: ReplayFrame[], now: Date, retentionSeconds: number): void => {
  const oldestAllowed = now.getTime() - retentionSeconds * 1000;
  let cutoff = 0;

  while (cutoff < frames.length && (frames[cutoff]?.capturedAt.getTime() ?? 0) < oldestAllowed) {
    cutoff += 1;
  }

  if (cutoff > 0) {
    frames.splice(0, cutoff);
  }
};
