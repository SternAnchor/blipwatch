import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeHttpServer,
  configureHttpServerLimits,
  createHttpApi,
  type HttpApi,
  HTTP_SERVER_LIMITS
} from "../src/api/http-api.js";
import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import type { RadarImageRenderer } from "../src/radar/renderer.js";
import type { RadarStatus } from "../src/radar/status.js";
import type { ReplayBuffer } from "../src/replay/replay-buffer.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
  calibrationCaptureIntervalMs: 10000,
  calibrationCapturePacketLimit: 250,
  imageSize: 32,
  logLevel: "debug",
  port: 0,
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
  radarTargetFadeMs: 8000,
  radarTargetMaxAgeMs: 15000,
  radarTargetPersistenceMs: 4000,
  radarUdpPort: 0,
  replayFrameIntervalMs: 1,
  replayRetentionSeconds: 300
};

const capturedAt = "2026-06-07T00:00:00.000Z";
const png = PNG.sync.write(new PNG({ height: 32, width: 32 }));

let api: HttpApi | undefined;

const createRenderer = (): RadarImageRenderer => ({
  applySpoke(): void {},
  getLatestMetadata() {
    return {
      activePixelCount: 10,
      imageSize: 32,
      lastFrameAt: capturedAt,
      lastSpokeAt: capturedAt,
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1,
      targetFadeMs: 8000,
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
      retentionSeconds: 300
    };
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
  retentionSeconds: 300
});

const radarStatus = (): RadarStatus => ({
  control: {
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
    imageAvailable: true,
    imageSize: 32,
    lastRenderedImageAt: capturedAt,
    lastSpokeAt: capturedAt,
    renderState: "ready",
    spokeCount: 7
  }
});

const startApi = async (): Promise<string> => {
  const { sink } = createMemorySink();
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
    replayBuffer: createReplayBuffer()
  });
  await api.start();

  const port = api.address()?.port;
  if (!port) {
    throw new Error("HTTP API did not expose a bound port");
  }

  return `http://127.0.0.1:${port}`;
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
    expect(dashboardBody).toContain("/api/radar/latest.png");
    expect(dashboardBody).toContain("Interface");
    expect(dashboardBody).toContain("Control");
    expect(dashboardBody).toContain("Radar State");
    expect(dashboardBody).toContain("Standby");
    expect(dashboardBody).toContain("Transmit");

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
    await expect(replay.json()).resolves.toMatchObject({ frameCount: 1, frameIntervalMs: 1, retentionSeconds: 300 });

    const frames = await fetch(`${baseUrl}/api/radar/replay/frames`);
    const framesBody = (await frames.json()) as { frames: Array<{ capturedAt: string; sizeBytes: number }> };
    expect(framesBody.frames).toHaveLength(1);
    expect(framesBody.frames[0]?.sizeBytes).toBeGreaterThan(0);

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
  });

  it("exposes explicit radar standby and transmit control endpoints", async () => {
    const { sink } = createMemorySink();
    const radarControl = {
      requestStandby: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      requestTransmit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
    api = createHttpApi({
      config,
      logger: createLogger({ level: "debug", sink }),
      radarControl,
      radarStatus,
      renderer: createRenderer(),
      replayBuffer: createReplayBuffer()
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
