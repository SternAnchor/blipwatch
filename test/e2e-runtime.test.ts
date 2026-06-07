import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

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

describe("runtime data path", () => {
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("receives a simulated radar packet, renders imagery, and captures replay", async () => {
    const { baseUrl, radarPort } = await startServer();

    await sendUdpPacket(
      radarPort,
      createPlaceholderSpokePacket({
        angleDegrees: 90,
        intensities: [0, 64, 128, 255],
        rangeMeters: 2000
      })
    );

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/radar/latest.json`);
      const body = (await response.json()) as { spokeCount: number };
      return body.spokeCount === 1;
    });

    const latestPng = await fetch(`${baseUrl}/radar/latest.png`);
    const image = PNG.sync.read(Buffer.from(await latestPng.arrayBuffer()));
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);

    const frames = await fetch(`${baseUrl}/radar/replay/frames`);
    const framesBody = (await frames.json()) as { frames: Array<{ capturedAt: string }> };
    expect(framesBody.frames).toHaveLength(1);
  });
});
