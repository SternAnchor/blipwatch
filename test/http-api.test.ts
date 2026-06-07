import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

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
import type { ReplayBuffer } from "../src/replay/replay-buffer.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  imageSize: 32,
  logLevel: "debug",
  port: 0,
  radarInterface: "127.0.0.1",
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
      imageSize: 32,
      lastFrameAt: capturedAt,
      lastSpokeAt: capturedAt,
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
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

const startApi = async (): Promise<string> => {
  const { sink } = createMemorySink();
  api = createHttpApi({
    config,
    logger: createLogger({ level: "debug", sink }),
    renderer: createRenderer(),
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

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: "blipwatch" });

    const latestJson = await fetch(`${baseUrl}/radar/latest.json`);
    await expect(latestJson.json()).resolves.toMatchObject({
      imageSize: 32,
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
    });

    const latestPng = await fetch(`${baseUrl}/radar/latest.png`);
    expect(latestPng.status).toBe(200);
    expect(latestPng.headers.get("cache-control")).toBe("no-store");
    expect(latestPng.headers.get("content-type")).toBe("image/png");
    const latestImage = PNG.sync.read(Buffer.from(await latestPng.arrayBuffer()));
    expect(latestImage.width).toBe(32);
    expect(latestImage.height).toBe(32);

    const replay = await fetch(`${baseUrl}/radar/replay`);
    await expect(replay.json()).resolves.toMatchObject({ frameCount: 1, frameIntervalMs: 1, retentionSeconds: 300 });

    const frames = await fetch(`${baseUrl}/radar/replay/frames`);
    const framesBody = (await frames.json()) as { frames: Array<{ capturedAt: string; sizeBytes: number }> };
    expect(framesBody.frames).toHaveLength(1);
    expect(framesBody.frames[0]?.sizeBytes).toBeGreaterThan(0);

    const replayFrame = await fetch(`${baseUrl}/radar/replay/frame?at=${encodeURIComponent(capturedAt)}`);
    expect(replayFrame.status).toBe(200);
    expect(replayFrame.headers.get("cache-control")).toBe("no-store");
    expect(replayFrame.headers.get("content-type")).toBe("image/png");
    expect(replayFrame.headers.get("x-blipwatch-frame-at")).toBe(capturedAt);
  });

  it("validates methods, paths, and replay frame lookup requests", async () => {
    const baseUrl = await startApi();

    const disallowedMethod = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(disallowedMethod.status).toBe(405);
    await expect(disallowedMethod.json()).resolves.toMatchObject({ error: "method_not_allowed" });

    const unknownPath = await fetch(`${baseUrl}/missing`);
    expect(unknownPath.status).toBe(404);
    await expect(unknownPath.json()).resolves.toMatchObject({ error: "not_found" });

    const missing = await fetch(`${baseUrl}/radar/replay/frame`);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: "missing_at" });

    const unavailable = await fetch(`${baseUrl}/radar/replay/frame?at=2026-06-07T00%3A00%3A01.000Z`);
    expect(unavailable.status).toBe(404);
    await expect(unavailable.json()).resolves.toMatchObject({ error: "frame_not_found" });
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
