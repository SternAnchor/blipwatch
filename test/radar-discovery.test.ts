import type { RemoteInfo } from "node:dgram";

import { describe, expect, it } from "vitest";

import { parseNavicoReport } from "../src/radar/discovery.js";

const remote: RemoteInfo = {
  address: "192.0.2.11",
  family: "IPv4",
  port: 6878,
  size: 0
};

describe("parseNavicoReport", () => {
  it("extracts conservative metadata from Navico status reports", () => {
    const payload = Buffer.concat([
      Buffer.from([0x01, 0xc4, 0x01, 0x00, 236, 6, 7, 8]),
      Buffer.from("HALO-123456\0", "ascii")
    ]);

    expect(
      parseNavicoReport({
        data: payload,
        receivedAt: new Date("2026-06-07T00:00:00.000Z"),
        remote
      })
    ).toMatchObject({
      command: "0xc4",
      dataEndpoint: "236.6.7.8",
      firstSeenAt: "2026-06-07T00:00:00.000Z",
      lastSeenAt: "2026-06-07T00:00:00.000Z",
      model: "HALO-123456",
      name: "HALO-123456",
      reportType: "0x01",
      serial: "HALO-123456",
      sourceAddress: "192.0.2.11",
      sourcePort: 6878,
      status: "0x01",
      statusName: "standby"
    });
  });

  it("ignores packets outside the Navico report envelope", () => {
    expect(
      parseNavicoReport({
        data: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        receivedAt: new Date("2026-06-07T00:00:00.000Z"),
        remote
      })
    ).toBeUndefined();
  });
});
