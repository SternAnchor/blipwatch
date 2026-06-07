import { describe, expect, it } from "vitest";

import { classifyRadarPacket } from "../src/radar/packet-classifier.js";
import { createPlaceholderSpokePacket } from "../src/sim/placeholder-fixture.js";

describe("classifyRadarPacket", () => {
  it("classifies empty, placeholder, HALO candidate, and unknown packets", () => {
    expect(classifyRadarPacket(Buffer.alloc(0))).toMatchObject({ kind: "empty" });
    expect(classifyRadarPacket(createPlaceholderSpokePacket())).toMatchObject({ kind: "placeholder-spoke" });
    expect(classifyRadarPacket(Buffer.from("HALO00000000"))).toMatchObject({ kind: "halo-candidate" });
    expect(classifyRadarPacket(Buffer.alloc(64, 0x7f))).toMatchObject({ kind: "halo-candidate" });
    expect(classifyRadarPacket(Buffer.alloc(8 + 536, 0))).toMatchObject({ kind: "navico-halo-frame" });
    expect(classifyRadarPacket(Buffer.from("nope"))).toMatchObject({ kind: "unknown" });
  });
});
