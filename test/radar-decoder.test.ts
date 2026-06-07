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
      error: { code: "unsupported-packet" },
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
});
