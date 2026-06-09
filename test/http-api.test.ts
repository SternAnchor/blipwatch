import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import {
  closeHttpServer,
  configureHttpServerLimits,
  createHttpApi,
  type HttpApi,
  HTTP_SERVER_LIMITS
} from "../src/api/http-api.js";
import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import type { RadarRangeRequest, RadarTuningRequestResult, RadarTuningSettingRequest } from "../src/radar/control.js";
import type { RadarSpoke } from "../src/radar/decoder.js";
import { createRawRecordingReplayController, type RawRecordingReplayController } from "../src/recording/raw-recording-replay.js";
import { createRawRecordingStore, type RawRecordingStore } from "../src/recording/raw-recording-store.js";
import type { RadarImageRenderer } from "../src/radar/renderer.js";
import type { RadarStatus } from "../src/radar/status.js";
import type { ReplayBuffer } from "../src/replay/replay-buffer.js";
import { createRadarTargetManager, type RadarTargetManager } from "../src/targets/target-manager.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
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
  replayFrameIntervalMs: 1,
  replayRetentionSeconds: 300,
  targetLostTimeoutSeconds: 10,
  targetTrackingEnabled: true
};

const capturedAt = "2026-06-07T00:00:00.000Z";
const playbackState = {
  currentFrameAt: null,
  mode: "live" as const,
  requestedAt: null,
  speed: 1 as const,
  status: "live" as const,
  updatedAt: capturedAt
};
const controlCapabilities = {
  gain: {
    reason: "HALO tuning command payloads are not implemented.",
    supported: false
  },
  rainClutter: {
    reason: "HALO tuning command payloads are not implemented.",
    supported: false
  },
  range: {
    reason: "HALO tuning command payloads are not implemented.",
    supported: false
  },
  seaClutter: {
    reason: "HALO tuning command payloads are not implemented.",
    supported: false
  }
};
const controlTuning = {
  gain: {
    lastError: null,
    lastRequestAt: null,
    mode: "auto" as const,
    value: null
  },
  rainClutter: {
    lastError: null,
    lastRequestAt: null,
    mode: "auto" as const,
    value: null
  },
  range: {
    lastError: null,
    lastRequestAt: null,
    rangeMeters: null
  },
  seaClutter: {
    lastError: null,
    lastRequestAt: null,
    mode: "auto" as const,
    value: null
  }
};
const png = PNG.sync.write(new PNG({ height: 32, width: 32 }));

let api: HttpApi | undefined;

const createRenderer = (): RadarImageRenderer => ({
  applySpoke(): void {},
  clear(): void {},
  getLatestMetadata() {
    return {
      activePixelCount: 10,
      imageSize: 32,
      lastFrameAt: capturedAt,
      lastSpokeAt: capturedAt,
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
  imageSize: 32
});

const createReplayBuffer = (): ReplayBuffer => ({
  captureFrame() {
    return undefined;
  },
  frameIntervalMs: 1,
  getFrameAt(timestamp: Date | string) {
    const requestedAt = typeof timestamp === "string" ? timestamp : timestamp.toISOString();
    if (requestedAt !== capturedAt) {
      return undefined;
    }

    return {
      capturedAt: new Date(capturedAt),
      metadata: createRenderer().getLatestMetadata(),
      png
    };
  },
  getMetadata() {
    return {
      frameCount: 1,
      frameIntervalMs: 1,
      newestFrameAt: capturedAt,
      oldestFrameAt: capturedAt,
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
        capturedAt,
        metadata: createRenderer().getLatestMetadata(),
        sizeBytes: png.byteLength
      }
    ];
  },
  retentionSeconds: 300,
  updatePlayback(command) {
    return {
      currentFrameAt: capturedAt,
      mode: command.action === "live" ? "live" : "replay",
      requestedAt: command.at ? new Date(command.at).toISOString() : null,
      speed: command.speed ?? 1,
      status: command.action === "resume" ? "playing" : command.action === "live" ? "live" : "paused",
      updatedAt: capturedAt
    };
  }
});

const createTargetManager = (): RadarTargetManager => {
  const { sink } = createMemorySink();
  return createRadarTargetManager({
    config,
    logger: createLogger({ level: "debug", sink })
  });
};

const createRecordingStore = (directory = "captures/recordings"): RawRecordingStore => {
  const { sink } = createMemorySink();
  return createRawRecordingStore({
    directory,
    logger: createLogger({ level: "debug", sink })
  });
};

const createRecordingReplay = (
  recordingStore: RawRecordingStore,
  renderer = createRenderer(),
  replayBuffer = createReplayBuffer()
): RawRecordingReplayController => {
  const { sink } = createMemorySink();
  return createRawRecordingReplayController({
    logger: createLogger({ level: "debug", sink }),
    recordingStore,
    renderer,
    replayBuffer
  });
};

const createSpoke = (): RadarSpoke => ({
  angleDegrees: 42,
  intensities: Uint8Array.from([0, 64, 255]),
  maxIntensity: 255,
  rangeMeters: 926,
  receivedAt: new Date(capturedAt),
  sampleCount: 3,
  type: "spoke"
});

const radarStatus = (): RadarStatus => ({
  control: {
    capabilities: controlCapabilities,
    commandTarget: "236.6.8.36:6516",
    commandTargetSource: "configured",
    commandsSent: 3,
    desiredState: "transmit",
    enabled: true,
    lastCommandAt: capturedAt,
    lastCommandName: "transmit-on-b",
    lastError: null,
    lastRequestAt: capturedAt,
    mode: "transmit",
    observedState: "standby",
    observedStateAt: capturedAt,
    observedStateSource: "report",
    running: true,
    stayAliveIntervalMs: 1000,
    tuning: controlTuning,
    wakeTarget: "236.6.7.5:6878"
  },
  decoder: {
    lastDecodedSpokeAt: capturedAt,
    packetsDecoded: 7,
    packetsRejected: 2
  },
  diagnostics: {
    nextActions: ["Open /api/radar/latest.png or /api/radar/latest.json to inspect current rendered imagery."],
    phase: "receiving-and-rendering",
    summary: "Radar spokes are decoding and rendering."
  },
  discovery: {
    boundInterface: "127.0.0.1",
    enabled: true,
    lastReportAt: capturedAt,
    lastReportSource: "192.0.2.11:6878",
    multicastInterface: "127.0.0.1",
    multicastGroup: "236.6.7.5",
    radar: {
      command: "0xc4",
      commandEndpoint: "236.6.8.36:6516",
      dataEndpoint: "236.6.7.8",
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
      model: "HALO",
      name: "HALO",
      reportEndpoint: "236.6.7.9:6679",
      reportType: "0x01",
      serial: "123456",
      sourceAddress: "192.0.2.11",
      sourcePort: 6878,
      status: "0x01",
      statusName: "standby"
    },
    reportsReceived: 3,
    running: true,
    udpPort: 6878
  },
  receiver: {
    boundInterface: "127.0.0.1",
    lastPacketAt: capturedAt,
    lastSourceAddress: "192.0.2.10:6678",
    multicastInterface: "127.0.0.1",
    multicastGroups: ["239.2.1.1"],
    packetsReceived: 9,
    running: true,
    udpPort: 6678
  },
  renderer: {
    activePixelCount: 10,
    imageAvailable: true,
    imageSize: 32,
    lastRenderedImageAt: capturedAt,
    lastSpokeAt: capturedAt,
    maxIntensity: 255,
    radarBrightnessScale: 100,
    radarRenderPalette: "chartplotter",
    renderState: "ready",
    spokeCount: 7,
    targetExpansion: 100,
    targetMaxAgeMs: 15000
  },
  process: {
    memory: {
      arrayBuffers: 4,
      external: 5,
      heapTotal: 2,
      heapUsed: 1,
      rss: 3
    },
    uptimeSeconds: 12
  },
  replay: {
    frameCount: 1,
    frameIntervalMs: 1,
    newestFrameAt: capturedAt,
    oldestFrameAt: capturedAt,
    playback: playbackState,
    retentionSeconds: 300,
    totalBytes: png.byteLength
  },
  streaming: {
    clientsConnected: 0,
    lastClientConnectedAt: null,
    lastMessageAt: null,
    messagesSent: 0,
    totalClientsConnected: 0,
    updatesDropped: 0
  },
  targets: {
    activeCount: 0,
    deletedCount: 0,
    enabled: true,
    lostCount: 0,
    lostTimeoutSeconds: 10,
    sourceCounts: {
      ais: 0,
      "blipwatch-detected": 0,
      "halo-native": 0,
      manual: 0
    },
    statusCounts: {
      lost: 0,
      new: 0,
      tracking: 0
    },
    totalCreated: 0,
    totalUpdated: 0
  }
});

const startApi = async (): Promise<string> => {
  const { sink } = createMemorySink();
  const recordingStore = createRecordingStore();
  api = createHttpApi({
    calibrationCaptureStatus: () => ({
      directory: "captures/calibration",
      enabled: false,
      intervalMs: 10000,
      lastCaptureAt: null,
      lastCaptureDirectory: null,
      resolvedDirectory: resolve("captures/calibration"),
      running: false
    }),
    config,
    logger: createLogger({ level: "debug", sink }),
    renderer: createRenderer(),
    radarStatus,
    recordingReplay: createRecordingReplay(recordingStore),
    recordingStore,
    replayBuffer: createReplayBuffer(),
    targetManager: createTargetManager()
  });
  await api.start();

  const port = api.address()?.port;
  if (!port) {
    throw new Error("HTTP API did not expose a bound port");
  }

  return `http://127.0.0.1:${port}`;
};

const readWebSocketMessage = async (socket: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("message", (data) => {
      const text =
        typeof data === "string"
          ? data
          : Buffer.concat(Array.isArray(data) ? data : [toBuffer(data)]).toString("utf8");
      resolve(JSON.parse(text) as Record<string, unknown>);
    });
  });

const toBuffer = (data: ArrayBuffer | Buffer): Buffer =>
  Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));

const listenOnPort = async (port: number): Promise<ReturnType<typeof createServer>> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
};

const findAdjacentPortPair = async (): Promise<number> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = await listenOnPort(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const nextServer = await listenOnPort(port + 1);
      await closeHttpServer(nextServer, 1);
      return port;
    } catch {
      // Try another random base port.
    } finally {
      await closeHttpServer(server, 1);
    }
  }

  throw new Error("could not find adjacent free ports for fallback test");
};

describe("HTTP API", () => {
  afterEach(async () => {
    await api?.stop();
    api = undefined;
  });

  it("serves health, latest image, latest metadata, and replay endpoints", async () => {
    const baseUrl = await startApi();

    const dashboard = await fetch(`${baseUrl}/`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get("content-type")).toContain("text/html");
    await expect(dashboard.text()).resolves.toContain("BlipWatch");
    const dashboardBody = await fetch(`${baseUrl}/`).then((response) => response.text());
    expect(dashboardBody).toContain('<link rel="icon" href="/favicon.ico"');
    expect(dashboardBody).toContain("/api/radar/latest.png");
    expect(dashboardBody).toContain("Interface");
    expect(dashboardBody).toContain("Control");
    expect(dashboardBody).toContain("Radar State");
    expect(dashboardBody).toContain("Standby");
    expect(dashboardBody).toContain("Transmit");
    expect(dashboardBody).toContain("Clear Screen");
    expect(dashboardBody).toContain("Targets");
    expect(dashboardBody).toContain("target-overlay");
    expect(dashboardBody).toContain("target-overlay-toggle");
    expect(dashboardBody).toContain("target-list");
    expect(dashboardBody).toContain("/api/targets");
    expect(dashboardBody).toContain("Active Pixels");
    expect(dashboardBody).toContain("Replay Memory");
    expect(dashboardBody).toContain("Heap Used");
    expect(dashboardBody).toContain("Stream Clients");
    expect(dashboardBody).toContain("Gain");
    expect(dashboardBody).toContain("Sea Clutter");
    expect(dashboardBody).toContain("Rain Clutter");
    expect(dashboardBody).toContain("Range Control");
    expect(dashboardBody).toContain("Advanced Controls");
    expect(dashboardBody).toContain("gain-mode");
    expect(dashboardBody).toContain("gain-value");
    expect(dashboardBody).toContain("sea-clutter-mode");
    expect(dashboardBody).toContain("sea-clutter-value");
    expect(dashboardBody).toContain("rain-clutter-mode");
    expect(dashboardBody).toContain("rain-clutter-value");
    expect(dashboardBody).toContain("range-unit");
    expect(dashboardBody).toContain("range-value");
    expect(dashboardBody).toContain("range-decrease");
    expect(dashboardBody).toContain("range-increase");
    expect(dashboardBody).toContain("Imperial");
    expect(dashboardBody).toContain("Metric");
    expect(dashboardBody).toContain("/api/radar/clear");
    expect(dashboardBody).toContain("/api/radar/control/settings");
    expect(dashboardBody).toContain("Replay");
    expect(dashboardBody).toContain("replay-slider");
    expect(dashboardBody).toContain("/api/radar/replay/playback");
    expect(dashboardBody).toContain("/api/radar/replay/frame");

    const favicon = await fetch(`${baseUrl}/favicon.ico`);
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toContain("image/x-icon");
    expect(Buffer.from(await favicon.arrayBuffer()).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));

    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    await expect(health.json()).resolves.toMatchObject({
      calibrationCapture: {
        directory: "captures/calibration",
        enabled: false,
        running: false
      },
      ok: true,
      service: "blipwatch"
    });

    const latestJson = await fetch(`${baseUrl}/api/radar/latest.json`);
    await expect(latestJson.json()).resolves.toMatchObject({
      imageSize: 32,
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
    });

    const status = await fetch(`${baseUrl}/api/radar/status`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      decoder: {
        packetsDecoded: 7,
        packetsRejected: 2
      },
      diagnostics: {
        phase: "receiving-and-rendering"
      },
      control: {
        commandTarget: "236.6.8.36:6516",
        commandTargetSource: "configured",
        commandsSent: 3,
        desiredState: "transmit",
        enabled: true,
        mode: "transmit",
        observedState: "standby",
        observedStateSource: "report",
        running: true
      },
      discovery: {
        lastReportSource: "192.0.2.11:6878",
        multicastGroup: "236.6.7.5",
        radar: {
          dataEndpoint: "236.6.7.8",
          statusName: "standby"
        },
        reportsReceived: 3,
        running: true,
        udpPort: 6878
      },
      receiver: {
        lastSourceAddress: "192.0.2.10:6678",
        multicastGroups: ["239.2.1.1"],
        packetsReceived: 9,
        running: true,
        udpPort: 6678
      },
      renderer: {
        imageAvailable: true,
        renderState: "ready",
        spokeCount: 7
      },
      targets: {
        activeCount: 0,
        enabled: true,
        lostTimeoutSeconds: 10
      }
    });

    const latestPng = await fetch(`${baseUrl}/api/radar/latest.png`);
    expect(latestPng.status).toBe(200);
    expect(latestPng.headers.get("cache-control")).toBe("no-store");
    expect(latestPng.headers.get("content-length")).toBe(png.byteLength.toString());
    expect(latestPng.headers.get("content-type")).toBe("image/png");
    const latestImage = PNG.sync.read(Buffer.from(await latestPng.arrayBuffer()));
    expect(latestImage.width).toBe(32);
    expect(latestImage.height).toBe(32);

    const replay = await fetch(`${baseUrl}/api/radar/replay`);
    await expect(replay.json()).resolves.toMatchObject({
      frameCount: 1,
      frameIntervalMs: 1,
      playback: {
        mode: "live",
        speed: 1,
        status: "live"
      },
      retentionSeconds: 300
    });

    const frames = await fetch(
      `${baseUrl}/api/radar/replay/frames?from=${encodeURIComponent(capturedAt)}&to=${encodeURIComponent(capturedAt)}&limit=1`
    );
    const framesBody = (await frames.json()) as { frames: Array<{ capturedAt: string; sizeBytes: number }> };
    expect(framesBody.frames).toHaveLength(1);
    expect(framesBody.frames[0]?.sizeBytes).toBeGreaterThan(0);

    const playback = await fetch(`${baseUrl}/api/radar/replay/playback`);
    await expect(playback.json()).resolves.toMatchObject({
      mode: "live",
      speed: 1,
      status: "live"
    });

    const jump = await fetch(`${baseUrl}/api/radar/replay/playback`, {
      body: JSON.stringify({ action: "jump", at: capturedAt, speed: 5 }),
      method: "POST"
    });
    expect(jump.status).toBe(200);
    await expect(jump.json()).resolves.toMatchObject({
      currentFrameAt: capturedAt,
      mode: "replay",
      requestedAt: capturedAt,
      speed: 5,
      status: "paused"
    });

    const replayFrame = await fetch(`${baseUrl}/api/radar/replay/frame?at=${encodeURIComponent(capturedAt)}`);
    expect(replayFrame.status).toBe(200);
    expect(replayFrame.headers.get("cache-control")).toBe("no-store");
    expect(replayFrame.headers.get("content-length")).toBe(png.byteLength.toString());
    expect(replayFrame.headers.get("content-type")).toBe("image/png");
    expect(replayFrame.headers.get("x-blipwatch-frame-at")).toBe(capturedAt);

    const legacyStatus = await fetch(`${baseUrl}/radar/status`);
    expect(legacyStatus.status).toBe(404);
  });

  it("validates methods, paths, and replay frame lookup requests", async () => {
    const baseUrl = await startApi();

    const disallowedMethod = await fetch(`${baseUrl}/api/health`, { method: "POST" });
    expect(disallowedMethod.status).toBe(405);
    await expect(disallowedMethod.json()).resolves.toMatchObject({ error: "method_not_allowed" });

    const unknownPath = await fetch(`${baseUrl}/missing`);
    expect(unknownPath.status).toBe(404);
    await expect(unknownPath.json()).resolves.toMatchObject({ error: "not_found" });

    const missing = await fetch(`${baseUrl}/api/radar/replay/frame`);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: "missing_at" });

    const unavailable = await fetch(`${baseUrl}/api/radar/replay/frame?at=2026-06-07T00%3A00%3A01.000Z`);
    expect(unavailable.status).toBe(404);
    await expect(unavailable.json()).resolves.toMatchObject({ error: "frame_not_found" });

    const invalidFrames = await fetch(`${baseUrl}/api/radar/replay/frames?from=not-a-date`);
    expect(invalidFrames.status).toBe(400);
    await expect(invalidFrames.json()).resolves.toMatchObject({ error: "invalid_timestamp" });

    const invalidPlayback = await fetch(`${baseUrl}/api/radar/replay/playback`, {
      body: JSON.stringify({ action: "scrub" }),
      method: "POST"
    });
    expect(invalidPlayback.status).toBe(400);
    await expect(invalidPlayback.json()).resolves.toMatchObject({ error: "missing_at" });

    const invalidSpeed = await fetch(`${baseUrl}/api/radar/replay/playback`, {
      body: JSON.stringify({ action: "resume", speed: 3 }),
      method: "POST"
    });
    expect(invalidSpeed.status).toBe(400);
    await expect(invalidSpeed.json()).resolves.toMatchObject({ error: "invalid_speed" });
  });

  it("exposes target list, read, rename, confirm, unconfirm, and delete endpoints", async () => {
    const { sink } = createMemorySink();
    const recordingStore = createRecordingStore();
    const targetManager = createTargetManager();
    const target = targetManager.upsertTarget({
      bearingDegrees: 42,
      confidence: 0.75,
      id: "halo-native-1",
      observedAt: new Date(),
      rangeMeters: 120,
      source: "halo-native"
    });
    api = createHttpApi({
      config,
      logger: createLogger({ level: "debug", sink }),
      radarStatus,
      recordingReplay: createRecordingReplay(recordingStore),
      recordingStore,
      renderer: createRenderer(),
      replayBuffer: createReplayBuffer(),
      targetManager
    });
    await api.start();

    const port = api.address()?.port;
    if (!port) {
      throw new Error("HTTP API did not expose a bound port");
    }
    const baseUrl = `http://127.0.0.1:${port}`;

    const list = await fetch(`${baseUrl}/api/targets`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      status: {
        activeCount: 1,
        totalCreated: 1
      },
      targets: [
        {
          id: target.id,
          rangeMeters: 120,
          source: "halo-native"
        }
      ]
    });

    const read = await fetch(`${baseUrl}/api/targets/${target.id}`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      target: {
        confirmed: false,
        id: target.id
      }
    });

    const rename = await fetch(`${baseUrl}/api/targets/${target.id}`, {
      body: JSON.stringify({ name: "Dock marker" }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });
    expect(rename.status).toBe(200);
    await expect(rename.json()).resolves.toMatchObject({
      target: {
        id: target.id,
        name: "Dock marker"
      }
    });

    const confirm = await fetch(`${baseUrl}/api/targets/${target.id}/confirm`, { method: "POST" });
    expect(confirm.status).toBe(200);
    await expect(confirm.json()).resolves.toMatchObject({
      target: {
        confirmed: true,
        id: target.id
      }
    });

    const unconfirm = await fetch(`${baseUrl}/api/targets/${target.id}/unconfirm`, { method: "POST" });
    expect(unconfirm.status).toBe(200);
    await expect(unconfirm.json()).resolves.toMatchObject({
      target: {
        confirmed: false,
        id: target.id
      }
    });

    const clearName = await fetch(`${baseUrl}/api/targets/${target.id}`, {
      body: JSON.stringify({ name: null }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });
    expect(clearName.status).toBe(200);
    const cleared = (await clearName.json()) as { target: { name?: string } };
    expect(cleared.target.name).toBeUndefined();

    const invalidRename = await fetch(`${baseUrl}/api/targets/${target.id}`, {
      body: JSON.stringify({ name: 42 }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });
    expect(invalidRename.status).toBe(400);
    await expect(invalidRename.json()).resolves.toMatchObject({ error: "invalid_name" });

    const missing = await fetch(`${baseUrl}/api/targets/missing`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: "target_not_found" });

    const deleted = await fetch(`${baseUrl}/api/targets/${target.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ deleted: true, id: target.id });

    const deletedRead = await fetch(`${baseUrl}/api/targets/${target.id}`);
    expect(deletedRead.status).toBe(404);
  });

  it("exposes raw recording start, stop, list, inspect, download, delete, and status endpoints", async () => {
    const { sink } = createMemorySink();
    const directory = await mkdtemp(join(tmpdir(), "blipwatch-http-recordings-"));
    const recordingStore = createRecordingStore(directory);
    api = createHttpApi({
      config,
      logger: createLogger({ level: "debug", sink }),
      radarStatus,
      recordingReplay: createRecordingReplay(recordingStore),
      recordingStore,
      renderer: createRenderer(),
      replayBuffer: createReplayBuffer(),
      targetManager: createTargetManager()
    });
    await api.start();

    const port = api.address()?.port;
    if (!port) {
      throw new Error("HTTP API did not expose a bound port");
    }
    const baseUrl = `http://127.0.0.1:${port}`;

    const start = await fetch(`${baseUrl}/api/recordings/start`, { method: "POST" });
    expect(start.status).toBe(201);
    const startBody = (await start.json()) as { recording: { id: string } };
    expect(startBody.recording.id).toContain("T");

    await recordingStore.appendSpoke(createSpoke(), new Date(capturedAt));

    const status = await fetch(`${baseUrl}/api/recordings/status`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      activeRecordingId: startBody.recording.id,
      recordingsStarted: 1,
      totalSpokesWritten: 1
    });

    const download = await fetch(`${baseUrl}/api/recordings/${startBody.recording.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(`${startBody.recording.id}-spokes.ndjson`);
    await expect(download.text()).resolves.toContain('"type":"spoke"');

    const replayStatus = await fetch(`${baseUrl}/api/recordings/replay`);
    expect(replayStatus.status).toBe(200);
    await expect(replayStatus.json()).resolves.toMatchObject({ state: "idle" });

    const replay = await fetch(`${baseUrl}/api/recordings/${startBody.recording.id}/replay`, {
      body: JSON.stringify({ speed: 10 }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(replay.status).toBe(202);
    const replayBody = (await replay.json()) as { replay: { currentRecordingId: string; state: string } };
    expect(replayBody.replay.currentRecordingId).toBe(startBody.recording.id);
    expect(["completed", "playing"]).toContain(replayBody.replay.state);

    const stopReplay = await fetch(`${baseUrl}/api/recordings/replay/playback`, {
      body: JSON.stringify({ action: "stop" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(stopReplay.status).toBe(200);
    await expect(stopReplay.json()).resolves.toMatchObject({
      replay: {
        state: "stopped"
      }
    });

    const stop = await fetch(`${baseUrl}/api/recordings/stop`, { method: "POST" });
    expect(stop.status).toBe(200);
    await expect(stop.json()).resolves.toMatchObject({
      recording: {
        id: startBody.recording.id,
        spokeCount: 1,
        status: "completed"
      }
    });

    const list = await fetch(`${baseUrl}/api/recordings`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      recordings: [
        {
          metadata: {
            id: startBody.recording.id,
            status: "completed"
          },
          ok: true
        }
      ]
    });

    const inspect = await fetch(`${baseUrl}/api/recordings/${startBody.recording.id}`);
    expect(inspect.status).toBe(200);
    await expect(inspect.json()).resolves.toMatchObject({
      metadata: {
        id: startBody.recording.id,
        spokeCount: 1
      },
      ok: true
    });

    const secondStop = await fetch(`${baseUrl}/api/recordings/stop`, { method: "POST" });
    expect(secondStop.status).toBe(409);
    await expect(secondStop.json()).resolves.toMatchObject({ error: "no_active_recording" });

    const deleted = await fetch(`${baseUrl}/api/recordings/${startBody.recording.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ deleted: true, id: startBody.recording.id });

    const deletedInspect = await fetch(`${baseUrl}/api/recordings/${startBody.recording.id}`);
    expect(deletedInspect.status).toBe(404);
  });

  it("falls back to the next HTTP port when the configured port is already in use", async () => {
    const blockedPort = await findAdjacentPortPair();
    const blocker = await listenOnPort(blockedPort);
    const { messages, sink } = createMemorySink();
    const recordingStore = createRecordingStore();
    api = createHttpApi({
      calibrationCaptureStatus: () => ({
        directory: "captures/calibration",
        enabled: false,
        intervalMs: 10000,
        lastCaptureAt: null,
        lastCaptureDirectory: null,
        resolvedDirectory: resolve("captures/calibration"),
        running: false
      }),
      config: {
        ...config,
        port: blockedPort,
        portFallbackMaxAttempts: 2
      },
      logger: createLogger({ level: "debug", sink }),
      renderer: createRenderer(),
      radarStatus,
      recordingReplay: createRecordingReplay(recordingStore),
      recordingStore,
      replayBuffer: createReplayBuffer(),
      targetManager: createTargetManager()
    });

    try {
      await api.start();
      expect(api.address()?.port).toBe(blockedPort + 1);
      expect(messages.some((message) => message.includes(`using fallback port ${blockedPort + 1}`))).toBe(true);
    } finally {
      await closeHttpServer(blocker, 1);
    }
  });

  it("streams radar snapshots and updates over WebSockets", async () => {
    const baseUrl = await startApi();
    const socket = new WebSocket(baseUrl.replace("http://", "ws://") + "/api/radar/stream");

    const snapshot = await readWebSocketMessage(socket);
    expect(snapshot).toMatchObject({
      image: {
        latestUrl: "/api/radar/latest.png"
      },
      reason: "status",
      type: "radar.snapshot"
    });

    api?.publishRadarUpdate({
      reason: "target",
      targetEvent: {
        at: capturedAt,
        target: {
          bearingDegrees: 42,
          confidence: 0.75,
          confirmed: false,
          firstSeenAt: capturedAt,
          id: "halo-native-1",
          lastSeenAt: capturedAt,
          rangeMeters: 120,
          source: "halo-native",
          status: "new"
        },
        targetId: "halo-native-1",
        type: "created"
      }
    });
    const update = await readWebSocketMessage(socket);
    expect(update).toMatchObject({
      reason: "target",
      replay: {
        frameCount: 1
      },
      targetEvent: {
        targetId: "halo-native-1",
        type: "created"
      },
      type: "radar.update"
    });

    expect(api?.getStreamingStats()).toMatchObject({
      clientsConnected: 1,
      messagesSent: 1,
      totalClientsConnected: 1
    });

    socket.close();
  });

  it("exposes explicit radar standby and transmit control endpoints", async () => {
    const { sink } = createMemorySink();
    const renderer = {
      ...createRenderer(),
      clear: vi.fn<() => void>()
    };
    const radarControl = {
      getStatus: vi.fn<() => RadarStatus["control"]>().mockReturnValue({
        ...radarStatus().control,
        tuning: controlTuning
      }),
      requestGain: vi.fn<(request: RadarTuningSettingRequest) => Promise<RadarTuningRequestResult>>().mockResolvedValue({
        message: "HALO tuning command payloads are not implemented.",
        ok: false,
        setting: "gain",
        supported: false
      }),
      requestRainClutter: vi
        .fn<(request: RadarTuningSettingRequest) => Promise<RadarTuningRequestResult>>()
        .mockResolvedValue({
        message: "HALO tuning command payloads are not implemented.",
        ok: false,
        setting: "rainClutter",
        supported: false
      }),
      requestRange: vi.fn<(request: RadarRangeRequest) => Promise<RadarTuningRequestResult>>().mockResolvedValue({
        message: "HALO tuning command payloads are not implemented.",
        ok: false,
        setting: "range",
        supported: false
      }),
      requestSeaClutter: vi
        .fn<(request: RadarTuningSettingRequest) => Promise<RadarTuningRequestResult>>()
        .mockResolvedValue({
        message: "HALO tuning command payloads are not implemented.",
        ok: false,
        setting: "seaClutter",
        supported: false
      }),
      requestStandby: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      requestTransmit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
    const recordingStore = createRecordingStore();
    api = createHttpApi({
      config,
      logger: createLogger({ level: "debug", sink }),
      radarControl,
      radarStatus,
      recordingReplay: createRecordingReplay(recordingStore),
      recordingStore,
      renderer,
      replayBuffer: createReplayBuffer(),
      targetManager: createTargetManager()
    });
    await api.start();

    const port = api.address()?.port;
    if (!port) {
      throw new Error("HTTP API did not expose a bound port");
    }
    const baseUrl = `http://127.0.0.1:${port}`;

    const transmit = await fetch(`${baseUrl}/api/radar/control/transmit`, { method: "POST" });
    expect(transmit.status).toBe(200);
    await expect(transmit.json()).resolves.toMatchObject({ desiredState: "transmit", ok: true });
    expect(radarControl.requestTransmit).toHaveBeenCalledOnce();

    const standby = await fetch(`${baseUrl}/api/radar/control/standby`, { method: "POST" });
    expect(standby.status).toBe(200);
    await expect(standby.json()).resolves.toMatchObject({ desiredState: "standby", ok: true });
    expect(radarControl.requestStandby).toHaveBeenCalledOnce();

    const settings = await fetch(`${baseUrl}/api/radar/control/settings`);
    expect(settings.status).toBe(200);
    await expect(settings.json()).resolves.toMatchObject({
      capabilities: {
        gain: {
          supported: false
        }
      },
      tuning: {
        gain: {
          mode: "auto"
        }
      }
    });

    const gain = await fetch(`${baseUrl}/api/radar/control/settings`, {
      body: JSON.stringify({ mode: "manual", setting: "gain", value: 42 }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(gain.status).toBe(501);
    await expect(gain.json()).resolves.toMatchObject({
      error: "radar_control_setting_unsupported",
      setting: "gain",
      supported: false
    });
    expect(radarControl.requestGain).toHaveBeenCalledWith({ mode: "manual", value: 42 });
    expect(renderer.clear).not.toHaveBeenCalled();

    const invalid = await fetch(`${baseUrl}/api/radar/control/settings`, {
      body: JSON.stringify({ mode: "manual", setting: "gain", value: 142 }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "invalid_value" });

    radarControl.requestRange.mockResolvedValueOnce({
      message: "HALO tuning command sent.",
      ok: true,
      setting: "range",
      supported: true
    });
    const range = await fetch(`${baseUrl}/api/radar/control/settings`, {
      body: JSON.stringify({ rangeMeters: 926, setting: "range" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(range.status).toBe(200);
    await expect(range.json()).resolves.toMatchObject({ ok: true, setting: "range", supported: true });
    expect(radarControl.requestRange).toHaveBeenCalledWith({ rangeMeters: 926 });
    expect(renderer.clear).toHaveBeenCalledOnce();

    const clear = await fetch(`${baseUrl}/api/radar/clear`, { method: "POST" });
    expect(clear.status).toBe(200);
    await expect(clear.json()).resolves.toMatchObject({ ok: true });
    expect(renderer.clear).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable radar control endpoints when no control handler is configured", async () => {
    const baseUrl = await startApi();

    const response = await fetch(`${baseUrl}/api/radar/control/transmit`, { method: "POST" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "radar_control_unavailable" });
  });

  it("configures defensive HTTP connection limits", () => {
    const httpServer = createServer();

    configureHttpServerLimits(httpServer);

    expect(httpServer.requestTimeout).toBe(HTTP_SERVER_LIMITS.requestTimeoutMs);
    expect(httpServer.headersTimeout).toBe(HTTP_SERVER_LIMITS.headersTimeoutMs);
    expect(httpServer.keepAliveTimeout).toBe(HTTP_SERVER_LIMITS.keepAliveTimeoutMs);
    expect(httpServer.maxRequestsPerSocket).toBe(HTTP_SERVER_LIMITS.maxRequestsPerSocket);
  });

  it("force closes lingering HTTP connections after the shutdown grace period", async () => {
    let markRequestReceived: () => void = () => {};
    const requestReceived = new Promise<void>((resolve) => {
      markRequestReceived = resolve;
    });
    const httpServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("partial");
      markRequestReceived();
    });
    const closeAllConnections = vi.spyOn(httpServer, "closeAllConnections");

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const port = (httpServer.address() as AddressInfo).port;
    const clientRequest = request({ host: "127.0.0.1", port });
    clientRequest.on("error", () => {});
    clientRequest.on("response", (response) => {
      response.resume();
    });
    clientRequest.end();

    await requestReceived;
    await closeHttpServer(httpServer, 1);

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(httpServer.listening).toBe(false);
  });
});
