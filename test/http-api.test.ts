import { createServer } from "node:http";

import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { configureHttpServerLimits, HTTP_SERVER_LIMITS } from "../src/api/http-api.js";
import { createPlaceholderSpokePacket } from "../src/sim/placeholder-fixture.js";
import { createBlipWatchServer, type BlipWatchServer } from "../src/server.js";
import { sendUdpPacket } from "./support/udp.js";

let server: BlipWatchServer | undefined;

const startServer = async (): Promise<{ readonly baseUrl: string; readonly radarPort: number }> => {
  server = createBlipWatchServer({
    IMAGE_SIZE: "32",
    LOG_LEVEL: "debug",
    PORT: "0",
    RADAR_INTERFACE: "127.0.0.1",
    RADAR_UDP_PORT: "0",
    REPLAY_FRAME_INTERVAL_MS: "1",
    REPLAY_RETENTION_SECONDS: "300"
  });
  await server.start();

  const addresses = server.addresses();
  if (!addresses.httpPort || !addresses.radarPort) {
    throw new Error("server did not expose bound ports");
  }

  return {
    baseUrl: `http://127.0.0.1:${addresses.httpPort}`,
    radarPort: addresses.radarPort
  };
};

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error("condition was not met before timeout");
};

describe("HTTP API", () => {
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("serves health, latest image, latest metadata, and replay endpoints", async () => {
    const { baseUrl, radarPort } = await startServer();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: "blipwatch" });

    await sendUdpPacket(radarPort, createPlaceholderSpokePacket());
    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/radar/latest.json`);
      const body = (await response.json()) as { spokeCount: number };
      return body.spokeCount === 1;
    });

    const latestJson = await fetch(`${baseUrl}/radar/latest.json`);
    await expect(latestJson.json()).resolves.toMatchObject({
      imageSize: 32,
      maxIntensity: 255,
      renderState: "ready",
      spokeCount: 1
    });

    const latestPng = await fetch(`${baseUrl}/radar/latest.png`);
    expect(latestPng.status).toBe(200);
    expect(latestPng.headers.get("content-type")).toBe("image/png");
    const png = PNG.sync.read(Buffer.from(await latestPng.arrayBuffer()));
    expect(png.width).toBe(32);
    expect(png.height).toBe(32);

    const replay = await fetch(`${baseUrl}/radar/replay`);
    await expect(replay.json()).resolves.toMatchObject({ frameCount: 1, frameIntervalMs: 1, retentionSeconds: 300 });

    const frames = await fetch(`${baseUrl}/radar/replay/frames`);
    const framesBody = (await frames.json()) as { frames: Array<{ capturedAt: string; sizeBytes: number }> };
    expect(framesBody.frames).toHaveLength(1);
    expect(framesBody.frames[0]?.sizeBytes).toBeGreaterThan(0);

    const replayFrame = await fetch(
      `${baseUrl}/radar/replay/frame?at=${encodeURIComponent(framesBody.frames[0]?.capturedAt ?? "")}`
    );
    expect(replayFrame.status).toBe(200);
    expect(replayFrame.headers.get("content-type")).toBe("image/png");
    expect(replayFrame.headers.get("x-blipwatch-frame-at")).toBe(framesBody.frames[0]?.capturedAt);
  });

  it("validates replay frame lookup requests", async () => {
    const { baseUrl } = await startServer();

    const missing = await fetch(`${baseUrl}/radar/replay/frame`);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: "missing_at" });

    const unavailable = await fetch(`${baseUrl}/radar/replay/frame?at=2026-06-07T00%3A00%3A00.000Z`);
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
});
