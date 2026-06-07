import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../src/config/config.js";

describe("loadConfig", () => {
  it("uses 1.0.0 defaults", () => {
    expect(loadConfig({})).toEqual({
      imageSize: 1024,
      logLevel: "info",
      port: 8080,
      radarControlEnabled: false,
      radarControlFallbackHost: "236.6.8.36",
      radarControlHost: "auto",
      radarControlMode: "wake",
      radarControlPort: 6516,
      radarControlStayAliveIntervalMs: 1000,
      radarControlWakeHost: "236.6.7.5",
      radarControlWakePort: 6878,
      radarDiscoveryEnabled: true,
      radarInterface: "auto",
      radarMulticastGroups: ["236.6.7.8"],
      radarReportMulticastGroup: "236.6.7.5",
      radarReportUdpPort: 6878,
      radarUdpPort: 6678,
      replayFrameIntervalMs: 1000,
      replayRetentionSeconds: 300
    });
  });

  it("enables debug logging", () => {
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it("allows image multicast groups to be disabled explicitly", () => {
    expect(loadConfig({ RADAR_MULTICAST_GROUPS: "" }).radarMulticastGroups).toEqual([]);
  });

  it("uses valid environment overrides", () => {
    expect(
      loadConfig({
        IMAGE_SIZE: "512",
        LOG_LEVEL: "debug",
        PORT: "9090",
        RADAR_CONTROL_ENABLED: "true",
        RADAR_CONTROL_FALLBACK_HOST: "236.6.8.37",
        RADAR_CONTROL_HOST: "236.6.8.36",
        RADAR_CONTROL_MODE: "transmit",
        RADAR_CONTROL_PORT: "6516",
        RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS: "500",
        RADAR_CONTROL_WAKE_HOST: "236.6.7.5",
        RADAR_CONTROL_WAKE_PORT: "6878",
        RADAR_DISCOVERY_ENABLED: "false",
        RADAR_INTERFACE: "192.0.2.10",
        RADAR_MULTICAST_GROUPS: "239.2.1.1, 239.2.1.2",
        RADAR_REPORT_MULTICAST_GROUP: "236.6.7.9",
        RADAR_REPORT_UDP_PORT: "6879",
        RADAR_UDP_PORT: "6679",
        REPLAY_FRAME_INTERVAL_MS: "250",
        REPLAY_RETENTION_SECONDS: "60"
      })
    ).toEqual({
      imageSize: 512,
      logLevel: "debug",
      port: 9090,
      radarControlEnabled: true,
      radarControlFallbackHost: "236.6.8.37",
      radarControlHost: "236.6.8.36",
      radarControlMode: "transmit",
      radarControlPort: 6516,
      radarControlStayAliveIntervalMs: 500,
      radarControlWakeHost: "236.6.7.5",
      radarControlWakePort: 6878,
      radarDiscoveryEnabled: false,
      radarInterface: "192.0.2.10",
      radarMulticastGroups: ["239.2.1.1", "239.2.1.2"],
      radarReportMulticastGroup: "236.6.7.9",
      radarReportUdpPort: 6879,
      radarUdpPort: 6679,
      replayFrameIntervalMs: 250,
      replayRetentionSeconds: 60
    });
  });

  it("rejects invalid integer values with readable errors", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ PORT: "abc" })).toThrow('PORT must be an integer; received "abc"');
  });

  it("rejects invalid ranges and enum values", () => {
    expect(() => loadConfig({ IMAGE_SIZE: "0" })).toThrow("IMAGE_SIZE must be greater than 0");
    expect(() => loadConfig({ RADAR_UDP_PORT: "70000" })).toThrow("RADAR_UDP_PORT must be between 0 and 65535");
    expect(() => loadConfig({ RADAR_DISCOVERY_ENABLED: "maybe" })).toThrow(
      'RADAR_DISCOVERY_ENABLED must be one of: true, false, 1, 0; received "maybe"'
    );
    expect(() => loadConfig({ RADAR_CONTROL_ENABLED: "maybe" })).toThrow(
      'RADAR_CONTROL_ENABLED must be one of: true, false, 1, 0; received "maybe"'
    );
    expect(() => loadConfig({ RADAR_CONTROL_MODE: "blast" })).toThrow(
      'RADAR_CONTROL_MODE must be one of: wake, transmit; received "blast"'
    );
    expect(() => loadConfig({ RADAR_CONTROL_HOST: "not-ip" })).toThrow(
      'RADAR_CONTROL_HOST must contain an IPv4 address; received "not-ip"'
    );
    expect(() => loadConfig({ RADAR_CONTROL_FALLBACK_HOST: "not-ip" })).toThrow(
      'RADAR_CONTROL_FALLBACK_HOST must contain an IPv4 address; received "not-ip"'
    );
    expect(() => loadConfig({ RADAR_CONTROL_WAKE_HOST: "not-ip" })).toThrow(
      'RADAR_CONTROL_WAKE_HOST must contain an IPv4 address; received "not-ip"'
    );
    expect(() => loadConfig({ RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS: "0" })).toThrow(
      "RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS must be greater than 0"
    );
    expect(() => loadConfig({ LOG_LEVEL: "trace" })).toThrow('LOG_LEVEL must be one of: debug, info; received "trace"');
    expect(() => loadConfig({ RADAR_INTERFACE: "   " })).toThrow("RADAR_INTERFACE must not be empty");
    expect(() => loadConfig({ RADAR_MULTICAST_GROUPS: "192.0.2.10" })).toThrow(
      'RADAR_MULTICAST_GROUPS must contain an IPv4 multicast address; received "192.0.2.10"'
    );
    expect(() => loadConfig({ RADAR_REPORT_MULTICAST_GROUP: "192.0.2.10" })).toThrow(
      'RADAR_REPORT_MULTICAST_GROUP must contain an IPv4 multicast address; received "192.0.2.10"'
    );
  });
});
