import { afterEach, describe, expect, it } from "vitest";

import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import { createRadarReceiver, type RadarPacket, type RadarReceiver } from "../src/radar/receiver.js";
import { createMemorySink } from "./support/logger.js";
import { sendUdpPacket } from "./support/udp.js";

const baseConfig: BlipWatchConfig = {
  imageSize: 1024,
  logLevel: "debug",
  port: 8080,
  radarInterface: "127.0.0.1",
  radarUdpPort: 0,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300
};

const waitForPacket = (receiver: RadarReceiver): Promise<RadarPacket> =>
  new Promise((resolve) => {
    const unsubscribe = receiver.onPacket((packet) => {
      unsubscribe();
      resolve(packet);
    });
  });

describe("createRadarReceiver", () => {
  let receiver: RadarReceiver | undefined;

  afterEach(async () => {
    await receiver?.stop();
    receiver = undefined;
  });

  it("binds to the configured interface and emits received UDP packets", async () => {
    const { messages, sink } = createMemorySink();
    const logger = createLogger({ level: "debug", sink });
    receiver = createRadarReceiver({ config: baseConfig, logger });

    await receiver.start();
    const address = receiver.address();
    expect(address?.address).toBe("127.0.0.1");
    expect(address?.port).toBeGreaterThan(0);

    const expectedData = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const packetPromise = waitForPacket(receiver);

    await sendUdpPacket(address?.port ?? 0, expectedData);

    const packet = await packetPromise;
    expect(packet.data).toEqual(expectedData);
    expect(packet.remote.address).toBe("127.0.0.1");
    expect(packet.receivedAt).toBeInstanceOf(Date);
    expect(messages.some((message) => message.includes("radar packet received count=1 bytes=4"))).toBe(true);
  });

  it("can start and stop cleanly without receiving traffic", async () => {
    const { messages, sink } = createMemorySink();
    const logger = createLogger({ level: "debug", sink });
    receiver = createRadarReceiver({ config: baseConfig, logger });

    await receiver.start();
    await receiver.stop();
    receiver = undefined;

    expect(messages.some((message) => message.includes("radar receiver stopped after 0 packets"))).toBe(true);
  });
});
