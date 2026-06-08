import { describe, expect, it } from "vitest";

import { parseReplayPackets } from "../src/sim/packet-replay.js";

describe("parseReplayPackets", () => {
  it("parses raw hex lines and JSON replay lines", () => {
    const packets = parseReplayPackets(`
      # captured from hardware test
      425753310101000a03e80004004080ff
      {"payloadHex":"42 57 53 31 01 01 00 14 03 e8 00 02 40 ff","delayMs":25}
    `);

    expect(packets).toHaveLength(2);
    expect(packets[0]?.delayMs).toBe(0);
    expect(packets[0]?.payload.toString("hex")).toBe("425753310101000a03e80004004080ff");
    expect(packets[1]?.delayMs).toBe(25);
    expect(packets[1]?.payload.toString("hex")).toBe("425753310101001403e8000240ff");
  });

  it("rejects invalid payloads with line numbers", () => {
    expect(() => parseReplayPackets("abc")).toThrow("Replay line 1 payload must be even-length hexadecimal");
    expect(() => parseReplayPackets('{"payloadHex":"00","delayMs":-1}')).toThrow(
      "Replay line 1 delayMs must be a non-negative integer"
    );
    expect(() => parseReplayPackets('{"delayMs":1}')).toThrow(
      "Replay line 1 must include a string payloadHex field"
    );
  });
});
