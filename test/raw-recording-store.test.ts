import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { RadarSpoke } from "../src/radar/decoder.js";
import {
  createRawRecordingStore,
  deserializeRawRecordingSpoke,
  RAW_RECORDING_FORMAT,
  serializeRawRecordingSpoke
} from "../src/recording/raw-recording-store.js";
import { createLogger } from "../src/logging/logger.js";
import { createMemorySink } from "./support/logger.js";

const createTempDirectory = async (): Promise<string> => mkdtemp(join(tmpdir(), "blipwatch-recording-"));

const createSpoke = (): RadarSpoke => ({
  angleDegrees: 42,
  intensities: Uint8Array.from([0, 64, 128, 255]),
  maxIntensity: 255,
  rangeMeters: 926,
  receivedAt: new Date("2026-06-09T00:00:00.000Z"),
  sampleCount: 4,
  type: "spoke"
});

describe("createRawRecordingStore", () => {
  it("starts, appends decoded spokes, stops, lists, and inspects recordings", async () => {
    const directory = await createTempDirectory();
    const { messages, sink } = createMemorySink();
    const store = createRawRecordingStore({
      directory,
      logger: createLogger({ level: "debug", sink })
    });

    const started = await store.startRecording(new Date("2026-06-09T00:00:00.000Z"));
    expect(started).toMatchObject({
      format: RAW_RECORDING_FORMAT,
      id: "2026-06-09T00-00-00-000Z",
      spokeCount: 0,
      status: "recording",
      totalBytes: 0
    });

    const afterAppend = await store.appendSpoke(createSpoke(), new Date("2026-06-09T00:00:01.000Z"));
    expect(afterAppend).toMatchObject({
      id: started.id,
      spokeCount: 1,
      status: "recording"
    });
    expect(afterAppend?.totalBytes).toBeGreaterThan(0);
    expect(store.getStatus()).toMatchObject({
      activeRecordingId: started.id,
      recordingsStarted: 1,
      totalSpokesWritten: 1
    });

    const stopped = await store.stopActiveRecording(new Date("2026-06-09T00:00:02.000Z"));
    expect(stopped).toMatchObject({
      completedAt: "2026-06-09T00:00:02.000Z",
      status: "completed"
    });
    expect(store.getStatus()).toMatchObject({
      activeRecordingId: null,
      recordingsStopped: 1
    });

    const spokes = await readFile(join(directory, started.id, "spokes.ndjson"), "utf8");
    expect(spokes.trim()).toContain('"type":"spoke"');
    const inspection = await store.inspectRecording(started.id);
    expect(inspection).toMatchObject({
      metadata: {
        id: started.id,
        spokeCount: 1,
        status: "completed"
      },
      ok: true
    });
    const recordings = await store.listRecordings();
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({ ok: true });
    expect(messages.some((message) => message.includes("raw recording started"))).toBe(true);
    expect(messages.some((message) => message.includes("raw recording completed"))).toBe(true);
  });

  it("records failed completion status and ignores appends without an active recording", async () => {
    const directory = await createTempDirectory();
    const store = createRawRecordingStore({
      directory,
      logger: createLogger({ level: "debug", sink: createMemorySink().sink })
    });

    expect(await store.appendSpoke(createSpoke())).toBeNull();
    await store.startRecording(new Date("2026-06-09T00:00:00.000Z"));
    const failed = await store.failActiveRecording("operator stopped test", new Date("2026-06-09T00:00:03.000Z"));

    expect(failed).toMatchObject({
      completedAt: "2026-06-09T00:00:03.000Z",
      error: "operator stopped test",
      status: "failed"
    });
    expect(await store.stopActiveRecording()).toBeNull();
  });

  it("reports malformed recording metadata during inspection", async () => {
    const directory = await createTempDirectory();
    await mkdir(join(directory, "bad-recording"), { recursive: true });
    await writeFile(join(directory, "bad-recording", "metadata.json"), '{"format":"nope"}', "utf8");

    const store = createRawRecordingStore({
      directory,
      logger: createLogger({ level: "debug", sink: createMemorySink().sink })
    });

    const inspection = await store.inspectRecording("bad-recording");
    expect(inspection).toMatchObject({
      error: "Recording metadata format is not supported",
      metadata: null,
      ok: false
    });
  });

  it("serializes and deserializes decoded spokes", () => {
    const spoke = createSpoke();
    const record = serializeRawRecordingSpoke(spoke, new Date("2026-06-09T00:00:01.000Z"));

    expect(record).toMatchObject({
      angleDegrees: 42,
      maxIntensity: 255,
      rangeMeters: 926,
      receivedAt: "2026-06-09T00:00:00.000Z",
      recordedAt: "2026-06-09T00:00:01.000Z",
      sampleCount: 4,
      type: "spoke"
    });
    expect(deserializeRawRecordingSpoke(record)).toMatchObject({
      angleDegrees: 42,
      intensities: Uint8Array.from([0, 64, 128, 255]),
      maxIntensity: 255,
      rangeMeters: 926,
      receivedAt: new Date("2026-06-09T00:00:00.000Z"),
      sampleCount: 4,
      type: "spoke"
    });
  });
});
