import { describe, expect, it } from "vitest";

import { resolveRadarInterface, selectRadarInterface } from "../src/radar/network-interface.js";

describe("radar network interface selection", () => {
  it("prefers a wired radar-subnet interface over Wi-Fi and virtual interfaces", () => {
    expect(
      selectRadarInterface({
        bridge100: [
          {
            address: "192.168.194.1",
            cidr: "192.168.194.1/24",
            family: "IPv4",
            internal: false,
            mac: "00:00:00:00:00:00",
            netmask: "255.255.255.0"
          }
        ],
        en0: [
          {
            address: "192.168.15.200",
            cidr: "192.168.15.200/24",
            family: "IPv4",
            internal: false,
            mac: "00:00:00:00:00:00",
            netmask: "255.255.255.0"
          }
        ],
        en7: [
          {
            address: "192.168.15.188",
            cidr: "192.168.15.188/24",
            family: "IPv4",
            internal: false,
            mac: "00:00:00:00:00:00",
            netmask: "255.255.255.0"
          }
        ]
      })
    ).toEqual({
      address: "192.168.15.188",
      name: "en7",
      score: 570
    });
  });

  it("uses configured interfaces without auto-selection", () => {
    expect(resolveRadarInterface("192.0.2.10")).toEqual({
      address: "192.0.2.10",
      name: "configured"
    });
  });

  it("falls back to all interfaces when auto has no usable IPv4 candidates", () => {
    expect(
      resolveRadarInterface("auto", {
        lo0: [
          {
            address: "127.0.0.1",
            cidr: "127.0.0.1/8",
            family: "IPv4",
            internal: true,
            mac: "00:00:00:00:00:00",
            netmask: "255.0.0.0"
          }
        ]
      })
    ).toEqual({
      address: "0.0.0.0",
      name: "all-interfaces"
    });
  });
});
