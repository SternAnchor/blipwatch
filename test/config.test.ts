import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../src/config/config.js";

describe("loadConfig", () => {
  it("uses 1.0.0 defaults", () => {
    expect(loadConfig({})).toEqual({
      calibrationCaptureDirectory: "captures/calibration",
      calibrationCaptureEnabled: false,
      calibrationCaptureIntervalMs: 10000,
      calibrationCapturePacketLimit: 250,
      headless: false,
      imageSize: 1024,
      logLevel: "info",
      openBrowser: true,
      port: 8080,
      portFallbackEnabled: true,
      portFallbackMaxAttempts: 5,
      radarBrightnessScale: 100,
      radarControlEnabled: true,
      radarControlFallbackHost: "236.6.8.36",
      radarControlHost: "auto",
      radarControlMode: "wake",
      radarControlPort: 6516,
      radarControlStayAliveIntervalMs: 1000,
      radarControlWakeHost: "236.6.7.5",
      radarControlWakePort: 6878,
      radarDiscoveryEnabled: true,
      radarDisplayRangeMeters: "auto",
      radarInterface: "auto",
      radarMulticastGroups: ["236.6.7.8"],
      radarReportMulticastGroup: "236.6.7.5",
      radarReportUdpPort: 6878,
      radarRenderPalette: "chartplotter",
      radarTargetFadeMs: 8000,
      radarTargetExpansion: 100,
      radarTargetMaxAgeMs: 15000,
      radarTargetPersistenceMs: 4000,
      radarUdpPort: 6678,
      rawRecordingDirectory: "captures/recordings",
      replayFrameIntervalMs: 1000,
      replayRetentionSeconds: 300,
      targetLostTimeoutSeconds: 10,
      targetTrackingEnabled: true
    });
  });

  it("enables debug logging", () => {
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });

  it("allows image multicast groups to be disabled explicitly", () => {
    expect(loadConfig({ RADAR_MULTICAST_GROUPS: "" }).radarMulticastGroups).toEqual([]);
  });

  it("accepts the short calibration capture directory alias", () => {
    expect(loadConfig({ CALIBRATION_CAPTURE_DIR: "tmp/calibration" }).calibrationCaptureDirectory).toBe(
      "tmp/calibration"
    );
  });

  it("uses valid environment overrides", () => {
    expect(
      loadConfig({
        CALIBRATION_CAPTURE_DIRECTORY: "tmp/calibration",
        CALIBRATION_CAPTURE_ENABLED: "true",
        CALIBRATION_CAPTURE_INTERVAL_MS: "5000",
        CALIBRATION_CAPTURE_PACKET_LIMIT: "42",
        HEADLESS: "true",
        IMAGE_SIZE: "512",
        LOG_LEVEL: "debug",
        OPEN_BROWSER: "true",
        PORT: "9090",
        PORT_FALLBACK_ENABLED: "false",
        PORT_FALLBACK_MAX_ATTEMPTS: "2",
        RADAR_BRIGHTNESS_SCALE: "125",
        RADAR_CONTROL_ENABLED: "false",
        RADAR_CONTROL_FALLBACK_HOST: "236.6.8.37",
        RADAR_CONTROL_HOST: "236.6.8.36",
        RADAR_CONTROL_MODE: "transmit",
        RADAR_CONTROL_PORT: "6516",
        RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS: "500",
        RADAR_CONTROL_WAKE_HOST: "236.6.7.5",
        RADAR_CONTROL_WAKE_PORT: "6878",
        RADAR_DISCOVERY_ENABLED: "false",
        RADAR_DISPLAY_RANGE_METERS: "463",
        RADAR_INTERFACE: "192.0.2.10",
        RADAR_MULTICAST_GROUPS: "239.2.1.1, 239.2.1.2",
        RADAR_REPORT_MULTICAST_GROUP: "236.6.7.9",
        RADAR_REPORT_UDP_PORT: "6879",
        RADAR_RENDER_PALETTE: "green",
        RADAR_TARGET_FADE_MS: "7000",
        RADAR_TARGET_EXPANSION: "150",
        RADAR_TARGET_MAX_AGE_MS: "12000",
        RADAR_TARGET_PERSISTENCE_MS: "3000",
        RADAR_UDP_PORT: "6679",
        RAW_RECORDING_DIRECTORY: "tmp/recordings",
        REPLAY_FRAME_INTERVAL_MS: "250",
        REPLAY_RETENTION_SECONDS: "60",
        TARGET_LOST_TIMEOUT_SECONDS: "30",
        TARGET_TRACKING_ENABLED: "false"
      })
    ).toEqual({
      calibrationCaptureDirectory: "tmp/calibration",
      calibrationCaptureEnabled: true,
      calibrationCaptureIntervalMs: 5000,
      calibrationCapturePacketLimit: 42,
      headless: true,
      imageSize: 512,
      logLevel: "debug",
      openBrowser: true,
      port: 9090,
      portFallbackEnabled: false,
      portFallbackMaxAttempts: 2,
      radarBrightnessScale: 125,
      radarControlEnabled: false,
      radarControlFallbackHost: "236.6.8.37",
      radarControlHost: "236.6.8.36",
      radarControlMode: "transmit",
      radarControlPort: 6516,
      radarControlStayAliveIntervalMs: 500,
      radarControlWakeHost: "236.6.7.5",
      radarControlWakePort: 6878,
      radarDiscoveryEnabled: false,
      radarDisplayRangeMeters: 463,
      radarInterface: "192.0.2.10",
      radarMulticastGroups: ["239.2.1.1", "239.2.1.2"],
      radarReportMulticastGroup: "236.6.7.9",
      radarReportUdpPort: 6879,
      radarRenderPalette: "green",
      radarTargetFadeMs: 7000,
      radarTargetExpansion: 150,
      radarTargetMaxAgeMs: 12000,
      radarTargetPersistenceMs: 3000,
      radarUdpPort: 6679,
      rawRecordingDirectory: "tmp/recordings",
      replayFrameIntervalMs: 250,
      replayRetentionSeconds: 60,
      targetLostTimeoutSeconds: 30,
      targetTrackingEnabled: false
    });
  });

  it("disables browser launch automatically in headless mode", () => {
    expect(loadConfig({ HEADLESS: "true" })).toMatchObject({
      headless: true,
      openBrowser: false
    });
    expect(loadConfig({ BLIPWATCH_HEADLESS: "1" })).toMatchObject({
      headless: true,
      openBrowser: false
    });
    expect(loadConfig({ HEADLESS: "true", OPEN_BROWSER: "true" })).toMatchObject({
      headless: true,
      openBrowser: true
    });
  });

  it("rejects invalid integer values with readable errors", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ PORT: "abc" })).toThrow('PORT must be an integer; received "abc"');
  });

  it("rejects invalid ranges and enum values", () => {
    expect(() => loadConfig({ IMAGE_SIZE: "0" })).toThrow("IMAGE_SIZE must be greater than 0");
    expect(() => loadConfig({ CALIBRATION_CAPTURE_INTERVAL_MS: "0" })).toThrow(
      "CALIBRATION_CAPTURE_INTERVAL_MS must be greater than 0"
    );
    expect(() => loadConfig({ CALIBRATION_CAPTURE_PACKET_LIMIT: "-1" })).toThrow(
      'CALIBRATION_CAPTURE_PACKET_LIMIT must be an integer; received "-1"'
    );
    expect(() => loadConfig({ CALIBRATION_CAPTURE_DIRECTORY: "   " })).toThrow(
      "CALIBRATION_CAPTURE_DIRECTORY must not be empty"
    );
    expect(() => loadConfig({ RADAR_UDP_PORT: "70000" })).toThrow("RADAR_UDP_PORT must be between 0 and 65535");
    expect(() => loadConfig({ RADAR_DISCOVERY_ENABLED: "maybe" })).toThrow(
      'RADAR_DISCOVERY_ENABLED must be one of: true, false, 1, 0; received "maybe"'
    );
    expect(() => loadConfig({ RADAR_DISPLAY_RANGE_METERS: "0" })).toThrow(
      "RADAR_DISPLAY_RANGE_METERS must be greater than 0"
    );
    expect(() => loadConfig({ RADAR_BRIGHTNESS_SCALE: "0" })).toThrow("RADAR_BRIGHTNESS_SCALE must be greater than 0");
    expect(() => loadConfig({ RADAR_RENDER_PALETTE: "purple" })).toThrow(
      'RADAR_RENDER_PALETTE must be one of: chartplotter, grayscale, green; received "purple"'
    );
    expect(() => loadConfig({ RADAR_TARGET_EXPANSION: "0" })).toThrow("RADAR_TARGET_EXPANSION must be greater than 0");
    expect(() => loadConfig({ RADAR_TARGET_FADE_MS: "0" })).toThrow("RADAR_TARGET_FADE_MS must be greater than 0");
    expect(() => loadConfig({ RADAR_TARGET_MAX_AGE_MS: "0" })).toThrow(
      "RADAR_TARGET_MAX_AGE_MS must be greater than 0"
    );
    expect(() => loadConfig({ RADAR_TARGET_PERSISTENCE_MS: "-1" })).toThrow(
      'RADAR_TARGET_PERSISTENCE_MS must be an integer; received "-1"'
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
    expect(() => loadConfig({ HEADLESS: "maybe" })).toThrow(
      'HEADLESS must be one of: true, false, 1, 0; received "maybe"'
    );
    expect(() => loadConfig({ OPEN_BROWSER: "maybe" })).toThrow(
      'OPEN_BROWSER must be one of: true, false, 1, 0; received "maybe"'
    );
    expect(() => loadConfig({ RAW_RECORDING_DIRECTORY: "   " })).toThrow(
      "RAW_RECORDING_DIRECTORY must not be empty"
    );
    expect(() => loadConfig({ PORT_FALLBACK_ENABLED: "maybe" })).toThrow(
      'PORT_FALLBACK_ENABLED must be one of: true, false, 1, 0; received "maybe"'
    );
    expect(() => loadConfig({ PORT_FALLBACK_MAX_ATTEMPTS: "0" })).toThrow(
      "PORT_FALLBACK_MAX_ATTEMPTS must be greater than 0"
    );
    expect(() => loadConfig({ TARGET_LOST_TIMEOUT_SECONDS: "0" })).toThrow(
      "TARGET_LOST_TIMEOUT_SECONDS must be greater than 0"
    );
    expect(() => loadConfig({ TARGET_TRACKING_ENABLED: "maybe" })).toThrow(
      'TARGET_TRACKING_ENABLED must be one of: true, false, 1, 0; received "maybe"'
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
