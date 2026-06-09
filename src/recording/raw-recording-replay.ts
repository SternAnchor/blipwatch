import { readFile } from "node:fs/promises";

import type { Logger } from "../logging/logger.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
import type { ReplayBuffer } from "../replay/replay-buffer.js";
import {
  deserializeRawRecordingSpoke,
  type RawRecordingSpokeRecord,
  type RawRecordingStore
} from "./raw-recording-store.js";

export type RawRecordingReplayAction = "pause" | "resume" | "stop";
export type RawRecordingReplayState = "completed" | "idle" | "paused" | "playing" | "stopped";

export interface RawRecordingReplayStatus {
  readonly completedAt: string | null;
  readonly currentRecordingId: string | null;
  readonly error: string | null;
  readonly loop: boolean;
  readonly position: number;
  readonly speed: number;
  readonly startedAt: string | null;
  readonly state: RawRecordingReplayState;
  readonly totalSpokes: number;
  readonly updatedAt: string | null;
}

export interface RawRecordingReplayController {
  getStatus(): RawRecordingReplayStatus;
  pause(): RawRecordingReplayStatus;
  play(id: string, options?: RawRecordingReplayOptions): Promise<RawRecordingReplayStatus>;
  resume(): RawRecordingReplayStatus;
  stop(): RawRecordingReplayStatus;
}

export interface RawRecordingReplayOptions {
  readonly loop?: boolean;
  readonly speed?: number;
}

interface RawRecordingReplayControllerOptions {
  readonly logger: Logger;
  readonly recordingStore: RawRecordingStore;
  readonly renderer: RadarImageRenderer;
  readonly replayBuffer: ReplayBuffer;
}

const DEFAULT_REPLAY_SPEED = 1;
const MAX_REPLAY_DELAY_MS = 1000;

export const createRawRecordingReplayController = ({
  logger,
  recordingStore,
  renderer,
  replayBuffer
}: RawRecordingReplayControllerOptions): RawRecordingReplayController => {
  let runToken = 0;
  let status = createIdleStatus();

  const setStatus = (next: Partial<RawRecordingReplayStatus>): RawRecordingReplayStatus => {
    status = {
      ...status,
      ...next,
      updatedAt: new Date().toISOString()
    };
    return status;
  };

  const runPlayback = async (
    token: number,
    id: string,
    records: readonly RawRecordingSpokeRecord[],
    options: Required<RawRecordingReplayOptions>
  ): Promise<void> => {
    try {
      do {
        for (let index = status.position; index < records.length; index += 1) {
          if (token !== runToken || status.state === "stopped") {
            return;
          }

          while (token === runToken && status.state === "paused") {
            await sleep(50);
          }

          const record = records[index];
          if (!record) {
            continue;
          }

          renderer.applySpoke(deserializeRawRecordingSpoke(record));
          const capturedAt = new Date();
          replayBuffer.captureFrame({
            capturedAt,
            metadata: renderer.getLatestMetadata(),
            png: renderer.getLatestPng()
          });
          setStatus({ position: index + 1, state: "playing" });

          const nextRecord = records[index + 1];
          if (nextRecord) {
            await sleep(getReplayDelayMs(record, nextRecord, options.speed));
          }
        }

        if (options.loop && token === runToken && status.state !== "stopped") {
          setStatus({ position: 0, state: "playing" });
        }
      } while (options.loop && token === runToken && status.state !== "stopped");

      if (token === runToken) {
        logger.info(`raw recording replay completed id=${id} spokes=${records.length}`);
        setStatus({ completedAt: new Date().toISOString(), position: records.length, state: "completed" });
      }
    } catch (error) {
      if (token === runToken) {
        setStatus({ error: error instanceof Error ? error.message : String(error), state: "stopped" });
      }
    }
  };

  return {
    getStatus(): RawRecordingReplayStatus {
      return status;
    },
    pause(): RawRecordingReplayStatus {
      return status.state === "playing" ? setStatus({ state: "paused" }) : status;
    },
    async play(id: string, options: RawRecordingReplayOptions = {}): Promise<RawRecordingReplayStatus> {
      const records = await loadRawRecordingSpokeRecords(recordingStore, id);
      runToken += 1;
      const token = runToken;
      const speed = normalizeReplaySpeed(options.speed);
      status = {
        completedAt: null,
        currentRecordingId: id,
        error: null,
        loop: options.loop ?? false,
        position: 0,
        speed,
        startedAt: new Date().toISOString(),
        state: "playing",
        totalSpokes: records.length,
        updatedAt: new Date().toISOString()
      };
      logger.info(`raw recording replay started id=${id} spokes=${records.length} speed=${speed} loop=${status.loop}`);
      void runPlayback(token, id, records, { loop: status.loop, speed });
      return status;
    },
    resume(): RawRecordingReplayStatus {
      return status.state === "paused" ? setStatus({ state: "playing" }) : status;
    },
    stop(): RawRecordingReplayStatus {
      runToken += 1;
      return setStatus({ completedAt: new Date().toISOString(), state: "stopped" });
    }
  };
};

export const loadRawRecordingSpokeRecords = async (
  recordingStore: RawRecordingStore,
  id: string
): Promise<readonly RawRecordingSpokeRecord[]> => {
  const inspection = await recordingStore.inspectRecording(id);
  if (!inspection.ok) {
    throw new Error(inspection.error ?? "Recording is not available");
  }

  const content = await readFile(inspection.spokesFile, "utf8");
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseRawRecordingSpokeRecord(line, index + 1));
};

const parseRawRecordingSpokeRecord = (line: string, lineNumber: number): RawRecordingSpokeRecord => {
  const parsed = JSON.parse(line) as Partial<RawRecordingSpokeRecord>;
  if (
    parsed.type !== "spoke" ||
    typeof parsed.angleDegrees !== "number" ||
    typeof parsed.intensitiesBase64 !== "string" ||
    typeof parsed.maxIntensity !== "number" ||
    typeof parsed.rangeMeters !== "number" ||
    typeof parsed.recordedAt !== "string" ||
    typeof parsed.sampleCount !== "number"
  ) {
    throw new Error(`Recording spoke line ${lineNumber} is malformed`);
  }

  return {
    angleDegrees: parsed.angleDegrees,
    intensitiesBase64: parsed.intensitiesBase64,
    maxIntensity: parsed.maxIntensity,
    rangeMeters: parsed.rangeMeters,
    receivedAt: typeof parsed.receivedAt === "string" ? parsed.receivedAt : null,
    recordedAt: parsed.recordedAt,
    sampleCount: parsed.sampleCount,
    type: "spoke"
  };
};

const createIdleStatus = (): RawRecordingReplayStatus => ({
  completedAt: null,
  currentRecordingId: null,
  error: null,
  loop: false,
  position: 0,
  speed: DEFAULT_REPLAY_SPEED,
  startedAt: null,
  state: "idle",
  totalSpokes: 0,
  updatedAt: null
});

const getReplayDelayMs = (
  current: RawRecordingSpokeRecord,
  next: RawRecordingSpokeRecord,
  speed: number
): number => {
  const deltaMs = new Date(next.recordedAt).getTime() - new Date(current.recordedAt).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 0;
  }

  return Math.min(MAX_REPLAY_DELAY_MS, Math.round(deltaMs / speed));
};

const normalizeReplaySpeed = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_REPLAY_SPEED;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Replay speed must be greater than 0");
  }

  return value;
};

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
