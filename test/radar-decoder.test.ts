import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logging/logger.js";
import { createRadarDecoder } from "../src/radar/decoder.js";
import { createPlaceholderSpokePacket } from "../src/sim/placeholder-fixture.js";
import { createMemorySink } from "./support/logger.js";

describe("createRadarDecoder", () => {
  it("decodes the placeholder spoke fixture into the normalized radar model", () => {
    const { messages, sink } = createMemorySink();
    const decoder = createRadarDecoder({ logger: createLogger({ level: "debug", sink }) });
    const packet = createPlaceholderSpokePacket();

    const result = decoder.decode(packet);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.spoke).toMatchObject({
      angleDegrees: 123.4,
      maxIntensity: 255,
      rangeMeters: 2000,
      sampleCount: 4,
      type: "spoke"
    });
    expect(Array.from(result.spoke.intensities)).toEqual([0, 15, 128, 255]);
    expect(messages.some((message) => message.includes("radar packet decoded type=spoke"))).toBe(true);
  });

  it("returns structured failures for malformed or unsupported packets", () => {
    const { messages, sink } = createMemorySink();
    const decoder = createRadarDecoder({ logger: createLogger({ level: "debug", sink }) });

    expect(decoder.decode(Buffer.alloc(0))).toEqual({
      error: { code: "empty-packet", message: "packet is empty" },
      ok: false
    });
    expect(decoder.decode(Buffer.from("nope"))).toMatchObject({
      error: { code: "incomplete-packet" },
      ok: false
    });
    expect(decoder.decode(Buffer.from("HALO00000000"))).toMatchObject({
      error: {
        code: "unsupported-packet",
        message: "HALO packet candidate decoding is not implemented: starts with HALO ASCII marker"
      },
      ok: false
    });
    expect(messages.some((message) => message.includes("radar packet decode skipped"))).toBe(true);
  });

  it("rejects incomplete declared sample payloads without throwing", () => {
    const { sink } = createMemorySink();
    const decoder = createRadarDecoder({ logger: createLogger({ level: "debug", sink }) });
    const incomplete = Buffer.from("425753310101000a03e800040102", "hex");

    expect(decoder.decode(incomplete)).toEqual({
      error: {
        code: "incomplete-packet",
        message: "spoke packet declared 4 samples but only 2 were present"
      },
      ok: false
    });
  });

  it("decodes the first valid Navico/HALO frame scan line into a radar spoke", () => {
    const { messages, sink } = createMemorySink();
    const decoder = createRadarDecoder({ logger: createLogger({ level: "debug", sink }) });
    const receivedAt = new Date("2026-06-07T00:00:00.000Z");

    const result = decoder.decode({
      data: createNavicoHaloFramePacket(),
      receivedAt,
      remote: {
        address: "192.0.2.10",
        family: "IPv4",
        port: 6678,
        size: 544
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.spoke).toMatchObject({
      angleDegrees: 90,
      maxIntensity: 255,
      rangeMeters: 2000,
      receivedAt,
      sampleCount: 1024,
      type: "spoke"
    });
    expect(Array.from(result.spoke.intensities.slice(0, 4))).toEqual([0, 255, 17, 238]);
    expect(messages.some((message) => message.includes("kind=navico-halo-frame"))).toBe(true);
  });
});

const createNavicoHaloFramePacket = (): Buffer => {
  const frame = Buffer.alloc(8 + 536);
  const lineOffset = 8;
  frame.writeUInt8(0x18, lineOffset);
  frame.writeUInt8(0x02, lineOffset + 1);
  frame.writeUInt16LE(0, lineOffset + 2);
  frame.writeUInt16LE(0x0020, lineOffset + 6);
  frame.writeUInt16LE(1024, lineOffset + 8);
  frame.writeUInt16LE(0xffff, lineOffset + 10);
  frame.writeUInt16LE(32000, lineOffset + 12);
  frame[lineOffset + 24] = 0xf0;
  frame[lineOffset + 25] = 0xe1;

  return frame;
};
