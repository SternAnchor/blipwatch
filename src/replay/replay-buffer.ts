import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageMetadata } from "../radar/renderer.js";

export interface ReplayBuffer {
  readonly frameIntervalMs: number;
  readonly retentionSeconds: number;
  captureFrame(frame: ReplayFrameInput): ReplayFrame | undefined;
  getFrameAt(timestamp: Date | string): ReplayFrame | undefined;
  getMetadata(): ReplayMetadata;
  getPlaybackState(): ReplayPlaybackState;
  listFrames(options?: ReplayFrameListOptions): ReplayFrameMetadata[];
  updatePlayback(command: ReplayPlaybackCommand): ReplayPlaybackState;
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
  readonly playback: ReplayPlaybackState;
  readonly retentionSeconds: number;
  readonly totalBytes: number;
}

export interface ReplayFrameListOptions {
  readonly from?: Date | string;
  readonly limit?: number;
  readonly to?: Date | string;
}

export type ReplayPlaybackAction = "jump" | "live" | "pause" | "resume" | "scrub";
export type ReplayPlaybackMode = "live" | "replay";
export type ReplayPlaybackSpeed = 1 | 2 | 5 | 10;
export type ReplayPlaybackStatus = "live" | "paused" | "playing";

export interface ReplayPlaybackCommand {
  readonly action: ReplayPlaybackAction;
  readonly at?: Date | string;
  readonly speed?: ReplayPlaybackSpeed;
}

export interface ReplayPlaybackState {
  readonly currentFrameAt: string | null;
  readonly mode: ReplayPlaybackMode;
  readonly requestedAt: string | null;
  readonly speed: ReplayPlaybackSpeed;
  readonly status: ReplayPlaybackStatus;
  readonly updatedAt: string;
}

export const createReplayBuffer = ({ config, logger }: ReplayBufferOptions): ReplayBuffer => {
  const frames: ReplayFrame[] = [];
  let lastCapturedAt: Date | undefined;
  let playbackState: ReplayPlaybackState = createPlaybackState({
    currentFrameAt: null,
    mode: "live",
    requestedAt: null,
    speed: 1,
    status: "live"
  });

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

      return getClosestFrame(frames, target);
    },
    getMetadata(): ReplayMetadata {
      return {
        frameCount: frames.length,
        frameIntervalMs: config.replayFrameIntervalMs,
        newestFrameAt: frames.at(-1)?.capturedAt.toISOString() ?? null,
        oldestFrameAt: frames[0]?.capturedAt.toISOString() ?? null,
        playback: playbackState,
        retentionSeconds: config.replayRetentionSeconds,
        totalBytes: getTotalFrameBytes(frames)
      };
    },
    getPlaybackState(): ReplayPlaybackState {
      return playbackState;
    },
    listFrames(options: ReplayFrameListOptions = {}): ReplayFrameMetadata[] {
      const from = parseOptionalTimestamp(options.from);
      const to = parseOptionalTimestamp(options.to);
      const limit = options.limit && options.limit > 0 ? options.limit : undefined;
      const matchingFrames = frames.filter((frame) => {
        const capturedAt = frame.capturedAt.getTime();
        return (!from || capturedAt >= from.getTime()) && (!to || capturedAt <= to.getTime());
      });

      return matchingFrames.slice(limit ? Math.max(matchingFrames.length - limit, 0) : 0).map((frame) => ({
        capturedAt: frame.capturedAt.toISOString(),
        metadata: frame.metadata,
        sizeBytes: frame.png.byteLength
      }));
    },
    retentionSeconds: config.replayRetentionSeconds,
    updatePlayback(command: ReplayPlaybackCommand): ReplayPlaybackState {
      playbackState = getNextPlaybackState(command, frames, playbackState);
      logger.debug(
        `replay playback updated action=${command.action} status=${playbackState.status} currentFrameAt=${playbackState.currentFrameAt ?? "none"} speed=${playbackState.speed}x`
      );
      return playbackState;
    }
  };
};

const createPlaybackState = (
  state: Omit<ReplayPlaybackState, "updatedAt">,
  updatedAt: Date = new Date()
): ReplayPlaybackState => ({
  ...state,
  updatedAt: updatedAt.toISOString()
});

const getNextPlaybackState = (
  command: ReplayPlaybackCommand,
  frames: readonly ReplayFrame[],
  currentState: ReplayPlaybackState
): ReplayPlaybackState => {
  if (command.action === "live") {
    return createPlaybackState({
      currentFrameAt: null,
      mode: "live",
      requestedAt: null,
      speed: command.speed ?? currentState.speed,
      status: "live"
    });
  }

  const requestedAt = normalizeRequestedAt(command.at);
  const selectedFrame = requestedAt ? getClosestFrame(frames, requestedAt) : frames.at(-1);
  const currentFrameAt = selectedFrame?.capturedAt.toISOString() ?? currentState.currentFrameAt;
  const speed = command.speed ?? currentState.speed;

  if (command.action === "resume") {
    return createPlaybackState({
      currentFrameAt,
      mode: "replay",
      requestedAt: requestedAt?.toISOString() ?? null,
      speed,
      status: "playing"
    });
  }

  return createPlaybackState({
    currentFrameAt,
    mode: "replay",
    requestedAt: requestedAt?.toISOString() ?? null,
    speed,
    status: "paused"
  });
};

const normalizeRequestedAt = (timestamp: Date | string | undefined): Date | undefined => {
  if (timestamp === undefined) {
    return undefined;
  }

  const parsed = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseOptionalTimestamp = (timestamp: Date | string | undefined): Date | undefined => {
  if (timestamp === undefined) {
    return undefined;
  }

  const parsed = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const getClosestFrame = (frames: readonly ReplayFrame[], target: Date): ReplayFrame | undefined =>
  frames.reduce<ReplayFrame | undefined>((closest, candidate) => {
    if (!closest) {
      return candidate;
    }

    const closestDistance = Math.abs(closest.capturedAt.getTime() - target.getTime());
    const candidateDistance = Math.abs(candidate.capturedAt.getTime() - target.getTime());
    return candidateDistance < closestDistance ? candidate : closest;
  }, undefined);

const getTotalFrameBytes = (frames: readonly ReplayFrame[]): number =>
  frames.reduce((total, frame) => total + frame.png.byteLength, 0);

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
