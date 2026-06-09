import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Logger } from "../logging/logger.js";
import type { RadarSpoke } from "../radar/decoder.js";

export const RAW_RECORDING_FORMAT = "blipwatch.raw-spokes";
export const RAW_RECORDING_VERSION = 1;

export type RawRecordingStatus = "completed" | "failed" | "recording";

export interface RawRecordingMetadata {
  readonly completedAt: string | null;
  readonly error: string | null;
  readonly format: typeof RAW_RECORDING_FORMAT;
  readonly id: string;
  readonly spokeCount: number;
  readonly spokesFile: string;
  readonly startedAt: string;
  readonly status: RawRecordingStatus;
  readonly totalBytes: number;
  readonly version: typeof RAW_RECORDING_VERSION;
}

export interface RawRecordingSpokeRecord {
  readonly angleDegrees: number;
  readonly intensitiesBase64: string;
  readonly maxIntensity: number;
  readonly rangeMeters: number;
  readonly receivedAt: string | null;
  readonly recordedAt: string;
  readonly sampleCount: number;
  readonly type: "spoke";
}

export interface RawRecordingInspection {
  readonly directory: string;
  readonly error: string | null;
  readonly metadata: RawRecordingMetadata | null;
  readonly metadataFile: string;
  readonly ok: boolean;
  readonly spokesFile: string;
}

export interface RawRecordingStoreStatus {
  readonly activeRecordingId: string | null;
  readonly directory: string;
  readonly recordingsStarted: number;
  readonly recordingsStopped: number;
  readonly totalSpokesWritten: number;
  readonly totalBytesWritten: number;
}

export interface RawRecordingStore {
  appendSpoke(spoke: RadarSpoke, recordedAt?: Date): Promise<RawRecordingMetadata | null>;
  failActiveRecording(error: string, completedAt?: Date): Promise<RawRecordingMetadata | null>;
  getStatus(): RawRecordingStoreStatus;
  inspectRecording(id: string): Promise<RawRecordingInspection>;
  listRecordings(): Promise<readonly RawRecordingInspection[]>;
  startRecording(startedAt?: Date): Promise<RawRecordingMetadata>;
  stopActiveRecording(completedAt?: Date): Promise<RawRecordingMetadata | null>;
}

interface RawRecordingStoreOptions {
  readonly directory: string;
  readonly logger: Logger;
}

const METADATA_FILE = "metadata.json";
const SPOKES_FILE = "spokes.ndjson";

export const createRawRecordingStore = ({ directory, logger }: RawRecordingStoreOptions): RawRecordingStore => {
  let activeMetadata: RawRecordingMetadata | null = null;
  let recordingsStarted = 0;
  let recordingsStopped = 0;
  let totalBytesWritten = 0;
  let totalSpokesWritten = 0;

  const persistMetadata = async (metadata: RawRecordingMetadata): Promise<void> => {
    await mkdir(join(directory, metadata.id), { recursive: true });
    await writeFile(getMetadataPath(directory, metadata.id), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  };

  const completeActiveRecording = async (
    status: Extract<RawRecordingStatus, "completed" | "failed">,
    completedAt: Date,
    error: string | null
  ): Promise<RawRecordingMetadata | null> => {
    if (!activeMetadata) {
      return null;
    }

    const metadata = {
      ...activeMetadata,
      completedAt: completedAt.toISOString(),
      error,
      status
    } satisfies RawRecordingMetadata;
    activeMetadata = null;
    recordingsStopped += 1;
    await persistMetadata(metadata);
    logger.info(`raw recording ${status} id=${metadata.id} spokes=${metadata.spokeCount} bytes=${metadata.totalBytes}`);
    return metadata;
  };

  return {
    async appendSpoke(spoke: RadarSpoke, recordedAt = new Date()): Promise<RawRecordingMetadata | null> {
      if (!activeMetadata) {
        return null;
      }

      const record = serializeRawRecordingSpoke(spoke, recordedAt);
      const line = `${JSON.stringify(record)}\n`;
      await appendFile(getSpokesPath(directory, activeMetadata.id), line, "utf8");
      const totalBytes = activeMetadata.totalBytes + Buffer.byteLength(line);
      const metadata = {
        ...activeMetadata,
        spokeCount: activeMetadata.spokeCount + 1,
        totalBytes
      } satisfies RawRecordingMetadata;
      activeMetadata = metadata;
      totalBytesWritten += Buffer.byteLength(line);
      totalSpokesWritten += 1;
      await persistMetadata(metadata);
      return metadata;
    },
    async failActiveRecording(error: string, completedAt = new Date()): Promise<RawRecordingMetadata | null> {
      return completeActiveRecording("failed", completedAt, error);
    },
    getStatus(): RawRecordingStoreStatus {
      return {
        activeRecordingId: activeMetadata?.id ?? null,
        directory,
        recordingsStarted,
        recordingsStopped,
        totalBytesWritten,
        totalSpokesWritten
      };
    },
    async inspectRecording(id: string): Promise<RawRecordingInspection> {
      return inspectRawRecording(directory, id);
    },
    async listRecordings(): Promise<readonly RawRecordingInspection[]> {
      await mkdir(directory, { recursive: true });
      const entries = await readdir(directory, { withFileTypes: true });
      const inspections = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => inspectRawRecording(directory, entry.name))
      );
      return inspections.sort((left, right) =>
        (right.metadata?.startedAt ?? right.directory).localeCompare(left.metadata?.startedAt ?? left.directory)
      );
    },
    async startRecording(startedAt = new Date()): Promise<RawRecordingMetadata> {
      if (activeMetadata) {
        throw new Error(`Raw recording ${activeMetadata.id} is already active`);
      }

      await mkdir(directory, { recursive: true });
      const id = await createRecordingId(directory, startedAt);
      const metadata = {
        completedAt: null,
        error: null,
        format: RAW_RECORDING_FORMAT,
        id,
        spokeCount: 0,
        spokesFile: SPOKES_FILE,
        startedAt: startedAt.toISOString(),
        status: "recording",
        totalBytes: 0,
        version: RAW_RECORDING_VERSION
      } satisfies RawRecordingMetadata;
      await mkdir(join(directory, id), { recursive: true });
      await writeFile(getSpokesPath(directory, id), "", "utf8");
      await persistMetadata(metadata);
      activeMetadata = metadata;
      recordingsStarted += 1;
      logger.info(`raw recording started id=${id}`);
      return metadata;
    },
    async stopActiveRecording(completedAt = new Date()): Promise<RawRecordingMetadata | null> {
      return completeActiveRecording("completed", completedAt, null);
    }
  };
};

export const serializeRawRecordingSpoke = (spoke: RadarSpoke, recordedAt = new Date()): RawRecordingSpokeRecord => ({
  angleDegrees: spoke.angleDegrees,
  intensitiesBase64: Buffer.from(spoke.intensities).toString("base64"),
  maxIntensity: spoke.maxIntensity,
  rangeMeters: spoke.rangeMeters,
  receivedAt: spoke.receivedAt?.toISOString() ?? null,
  recordedAt: recordedAt.toISOString(),
  sampleCount: spoke.sampleCount,
  type: "spoke"
});

export const deserializeRawRecordingSpoke = (record: RawRecordingSpokeRecord): RadarSpoke => ({
  angleDegrees: record.angleDegrees,
  intensities: Uint8Array.from(Buffer.from(record.intensitiesBase64, "base64")),
  maxIntensity: record.maxIntensity,
  rangeMeters: record.rangeMeters,
  receivedAt: record.receivedAt ? new Date(record.receivedAt) : undefined,
  sampleCount: record.sampleCount,
  type: "spoke"
});

const inspectRawRecording = async (directory: string, id: string): Promise<RawRecordingInspection> => {
  const recordingDirectory = join(directory, id);
  const metadataFile = getMetadataPath(directory, id);
  const spokesFile = getSpokesPath(directory, id);
  try {
    const metadata = parseRawRecordingMetadata(await readFile(metadataFile, "utf8"));
    await stat(spokesFile);
    return {
      directory: recordingDirectory,
      error: null,
      metadata,
      metadataFile,
      ok: true,
      spokesFile
    };
  } catch (error) {
    return {
      directory: recordingDirectory,
      error: error instanceof Error ? error.message : String(error),
      metadata: null,
      metadataFile,
      ok: false,
      spokesFile
    };
  }
};

const parseRawRecordingMetadata = (content: string): RawRecordingMetadata => {
  const parsed = JSON.parse(content) as Partial<RawRecordingMetadata>;
  if (parsed.format !== RAW_RECORDING_FORMAT) {
    throw new Error("Recording metadata format is not supported");
  }

  if (parsed.version !== RAW_RECORDING_VERSION) {
    throw new Error("Recording metadata version is not supported");
  }

  if (
    typeof parsed.id !== "string" ||
    typeof parsed.startedAt !== "string" ||
    typeof parsed.spokesFile !== "string" ||
    typeof parsed.spokeCount !== "number" ||
    typeof parsed.totalBytes !== "number" ||
    (parsed.status !== "recording" && parsed.status !== "completed" && parsed.status !== "failed")
  ) {
    throw new Error("Recording metadata is malformed");
  }

  return {
    completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
    error: typeof parsed.error === "string" ? parsed.error : null,
    format: RAW_RECORDING_FORMAT,
    id: parsed.id,
    spokeCount: parsed.spokeCount,
    spokesFile: parsed.spokesFile,
    startedAt: parsed.startedAt,
    status: parsed.status,
    totalBytes: parsed.totalBytes,
    version: RAW_RECORDING_VERSION
  };
};

const createRecordingId = async (directory: string, startedAt: Date): Promise<string> => {
  const baseId = startedAt.toISOString().replaceAll(/[:.]/g, "-");
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? baseId : `${baseId}-${suffix}`;
    try {
      await stat(join(directory, candidate));
    } catch {
      return candidate;
    }
  }

  throw new Error("Unable to allocate raw recording id");
};

const getMetadataPath = (directory: string, id: string): string => join(directory, id, METADATA_FILE);

const getSpokesPath = (directory: string, id: string): string => join(directory, id, SPOKES_FILE);
