import { describe, expect, it } from "vitest";

import { summarizeReplayPackets } from "../src/sim/packet-summary.js";

describe("summarizeReplayPackets", () => {
  it("groups packets by classifier kind, length, and prefix", () => {
    const summary = summarizeReplayPackets([
      { delayMs: 0, payload: Buffer.from("425753310101000a03e80004004080ff", "hex") },
      { delayMs: 25, payload: Buffer.from("48414c4f01020304", "hex") },
      { delayMs: 50, payload: Buffer.from("48414c4f01020304", "hex") }
    ]);

    expect(summary.packetCount).toBe(3);
    expect(summary.totalDelayMs).toBe(75);
    expect(summary.totalPayloadBytes).toBe(32);
    expect(summary.minLengthBytes).toBe(8);
    expect(summary.maxLengthBytes).toBe(16);
    expect(summary.kindCounts).toEqual([
      { count: 2, key: "halo-candidate" },
      { count: 1, key: "placeholder-spoke" }
    ]);
    expect(summary.lengthCounts).toEqual([
      { count: 2, key: "8" },
      { count: 1, key: "16" }
    ]);
    expect(summary.prefixCounts[0]).toEqual({ count: 2, key: "48414c4f01020304" });
    expect(summary.averageEntropyBits).toBeGreaterThan(2);
  });

  it("returns zero values for empty captures", () => {
    expect(summarizeReplayPackets([])).toEqual({
      averageEntropyBits: 0,
      firstPacketDelayMs: 0,
      kindCounts: [],
      lengthCounts: [],
      maxLengthBytes: 0,
      minLengthBytes: 0,
      packetCount: 0,
      prefixCounts: [],
      totalDelayMs: 0,
      totalPayloadBytes: 0
    });
  });
});
