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
      Buffer.from([0x01, 0xc4, 0x01, 0x00, 236, 6, 7, 8, 0x1a, 0x16, 236, 6, 8, 36, 0x19, 0x74, 0x00]),
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
      commandEndpoint: "236.6.8.36:6516",
      dataEndpoint: "236.6.7.8",
      firstSeenAt: "2026-06-07T00:00:00.000Z",
      lastSeenAt: "2026-06-07T00:00:00.000Z",
      model: "HALO-123456",
      name: "HALO-123456",
      reportEndpoint: null,
      reportType: "0x01",
      serial: "HALO-123456",
      sourceAddress: "192.0.2.11",
      sourcePort: 6878,
      status: "0x01",
      statusName: "standby"
    });
  });

  it("extracts primary data, command, and report endpoints from Navico 01B2 location reports", () => {
    const payload = Buffer.from(
      "01b231323932363534353100000000000000a9fe9d8701330600fdff2001020010000000ec06070c177011000000ec0607161a261f002001020010000000ec0607171a1c11000000ec0607181a1d10002001030010000000ec0607081a1611000000ec06070a1a1812000000ec0607091a1710002002030010000000ec06070d177111000000ec06070e177212000000ec06070d177312002001030010000000ec0607121a2011000000ec0607141a2212000000ec0607131a2112002002030010000000ec06070d177411000000ec06070f177512000000ec06070d1776",
      "hex"
    );

    expect(
      parseNavicoReport({
        data: payload,
        receivedAt: new Date("2026-06-07T00:00:00.000Z"),
        remote
      })
    ).toMatchObject({
      command: "0xb2",
      commandEndpoint: "236.6.7.10:6680",
      dataEndpoint: "236.6.7.8:6678",
      name: "129265451",
      reportEndpoint: "236.6.7.9:6679",
      serial: "129265451"
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
