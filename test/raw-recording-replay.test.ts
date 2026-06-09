import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";

import type { RadarImageRenderer } from "../src/radar/renderer.js";
import type { ReplayBuffer } from "../src/replay/replay-buffer.js";
import { createRawRecordingReplayController, loadRawRecordingSpokeRecords } from "../src/recording/raw-recording-replay.js";
import { createRawRecordingStore } from "../src/recording/raw-recording-store.js";
import { createLogger } from "../src/logging/logger.js";
import { createMemorySink } from "./support/logger.js";

const png = PNG.sync.write(new PNG({ height: 8, width: 8 }));

const createRenderer = (): RadarImageRenderer => ({
  applySpoke: vi.fn<RadarImageRenderer["applySpoke"]>(),
  clear(): void {},
  getLatestMetadata() {
    return {
      activePixelCount: 1,
      imageSize: 8,
      lastFrameAt: "2026-06-09T00:00:00.000Z",
      lastSpokeAt: "2026-06-09T00:00:00.000Z",
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
  },
  getLatestPng() {
    return png;
  },
  imageSize: 8
});

const createReplayBuffer = (): ReplayBuffer => ({
  captureFrame: vi.fn<ReplayBuffer["captureFrame"]>(),
  frameIntervalMs: 1,
  getFrameAt() {
    return undefined;
  },
  getMetadata() {
    return {
      frameCount: 0,
      frameIntervalMs: 1,
      newestFrameAt: null,
      oldestFrameAt: null,
      playback: {
        currentFrameAt: null,
        mode: "live",
        requestedAt: null,
        speed: 1,
        status: "live",
        updatedAt: "2026-06-09T00:00:00.000Z"
      },
      retentionSeconds: 300,
      totalBytes: 0
    };
  },
  getPlaybackState() {
    return this.getMetadata().playback;
  },
  listFrames() {
    return [];
  },
  retentionSeconds: 300,
  updatePlayback() {
    return this.getMetadata().playback;
  }
});

const createStoreWithRecording = async () => {
  const directory = await mkdtemp(join(tmpdir(), "blipwatch-replay-"));
  const store = createRawRecordingStore({
    directory,
    logger: createLogger({ level: "debug", sink: createMemorySink().sink })
  });
  const recording = await store.startRecording(new Date("2026-06-09T00:00:00.000Z"));
  await store.appendSpoke(
    {
      angleDegrees: 10,
      intensities: Uint8Array.from([0, 128, 255]),
      maxIntensity: 255,
      rangeMeters: 500,
      receivedAt: new Date("2026-06-09T00:00:00.000Z"),
      sampleCount: 3,
      type: "spoke"
    },
    new Date("2026-06-09T00:00:00.000Z")
  );
  await store.appendSpoke(
    {
      angleDegrees: 20,
      intensities: Uint8Array.from([10, 20, 30]),
      maxIntensity: 30,
      rangeMeters: 600,
      receivedAt: new Date("2026-06-09T00:00:01.000Z"),
      sampleCount: 3,
      type: "spoke"
    },
    new Date("2026-06-09T00:00:00.000Z")
  );
  await store.stopActiveRecording(new Date("2026-06-09T00:00:02.000Z"));
  return { recording, store };
};

const waitForState = async (
  controller: ReturnType<typeof createRawRecordingReplayController>,
  state: string
): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (controller.getStatus().state === state) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`Replay did not reach state ${state}`);
};

describe("createRawRecordingReplayController", () => {
  it("loads recorded spokes and replays them through renderer and replay buffer", async () => {
    const { recording, store } = await createStoreWithRecording();
    const renderer = createRenderer();
    const replayBuffer = createReplayBuffer();
    const controller = createRawRecordingReplayController({
      logger: createLogger({ level: "debug", sink: createMemorySink().sink }),
      recordingStore: store,
      renderer,
      replayBuffer
    });

    await expect(loadRawRecordingSpokeRecords(store, recording.id)).resolves.toHaveLength(2);
    await controller.play(recording.id, { speed: 10 });
    await waitForState(controller, "completed");

    expect((renderer.applySpoke as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
    expect((replayBuffer.captureFrame as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
    expect(controller.getStatus()).toMatchObject({
      currentRecordingId: recording.id,
      position: 2,
      state: "completed",
      totalSpokes: 2
    });
  });

  it("supports pause, resume, and stop state controls", async () => {
    const { recording, store } = await createStoreWithRecording();
    const controller = createRawRecordingReplayController({
      logger: createLogger({ level: "debug", sink: createMemorySink().sink }),
      recordingStore: store,
      renderer: createRenderer(),
      replayBuffer: createReplayBuffer()
    });

    await controller.play(recording.id, { loop: true, speed: 100 });
    expect(controller.pause()).toMatchObject({ state: "paused" });
    expect(controller.resume()).toMatchObject({ state: "playing" });
    expect(controller.stop()).toMatchObject({ state: "stopped" });
  });
});
