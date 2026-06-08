import { describe, expect, it } from "vitest";

import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import { createRadarControl, navicoControlCommands } from "../src/radar/control.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
  calibrationCaptureIntervalMs: 10000,
  calibrationCapturePacketLimit: 250,
  imageSize: 1024,
  logLevel: "debug",
  port: 8080,
  radarBrightnessScale: 100,
  radarControlEnabled: false,
  radarControlFallbackHost: "236.6.8.36",
  radarControlHost: "auto",
  radarControlMode: "wake",
  radarControlPort: 6516,
  radarControlStayAliveIntervalMs: 1000,
  radarControlWakeHost: "236.6.7.5",
  radarControlWakePort: 6878,
  radarDiscoveryEnabled: false,
  radarDisplayRangeMeters: "auto",
  radarInterface: "127.0.0.1",
  radarMulticastGroups: [],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 0,
  radarRenderPalette: "chartplotter",
  radarTargetFadeMs: 8000,
  radarTargetExpansion: 100,
  radarTargetMaxAgeMs: 15000,
  radarTargetPersistenceMs: 4000,
  radarUdpPort: 0,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

describe("Navico radar control commands", () => {
  it("keeps the documented wake, transmit, and stay-alive byte sequences stable", () => {
    expect(navicoControlCommands.wake.toString("hex")).toBe("01b1");
    expect(navicoControlCommands.transmitOn.map((command) => command.toString("hex"))).toEqual(["00c101", "01c101"]);
    expect(navicoControlCommands.transmitOff.map((command) => command.toString("hex"))).toEqual(["00c101", "01c100"]);
    expect(navicoControlCommands.stayAlive.map((command) => command.toString("hex"))).toEqual([
      "a0c1",
      "03c2",
      "04c2",
      "05c2",
      "0ac2"
    ]);
  });

  it("reports discovered command targets when control host is automatic", () => {
    const { sink } = createMemorySink();
    const control = createRadarControl({
      commandTargetProvider: () => ({
        host: "236.6.8.99",
        port: 6517,
        source: "discovered"
      }),
      config,
      logger: createLogger({ level: "debug", sink }),
      observedStateProvider: () => ({
        observedAt: "2026-06-07T00:00:00.000Z",
        source: "report",
        state: "transmit"
      })
    });

    expect(control.getStatus()).toMatchObject({
      capabilities: {
        gain: {
          supported: false
        },
        rainClutter: {
          supported: false
        },
        range: {
          supported: false
        },
        seaClutter: {
          supported: false
        }
      },
      commandTarget: "236.6.8.99:6517",
      commandTargetSource: "discovered",
      desiredState: "standby",
      observedState: "transmit",
      observedStateAt: "2026-06-07T00:00:00.000Z",
      observedStateSource: "report"
    });
  });

  it("records unsupported tuning requests without sending unverified HALO commands", async () => {
    const { sink } = createMemorySink();
    const control = createRadarControl({
      config,
      logger: createLogger({ level: "debug", sink })
    });

    await expect(control.requestGain({ mode: "manual", value: 42 })).resolves.toMatchObject({
      ok: false,
      setting: "gain",
      supported: false
    });
    await expect(control.requestSeaClutter({ mode: "auto" })).resolves.toMatchObject({
      ok: false,
      setting: "seaClutter",
      supported: false
    });
    await expect(control.requestRainClutter({ mode: "manual", value: 12 })).resolves.toMatchObject({
      ok: false,
      setting: "rainClutter",
      supported: false
    });
    await expect(control.requestRange({ rangeMeters: 463 })).resolves.toMatchObject({
      ok: false,
      setting: "range",
      supported: false
    });

    expect(control.getStatus()).toMatchObject({
      commandsSent: 0,
      tuning: {
        gain: {
          mode: "manual",
          value: 42
        },
        rainClutter: {
          mode: "manual",
          value: 12
        },
        range: {
          rangeMeters: 463
        },
        seaClutter: {
          mode: "auto",
          value: null
        }
      }
    });
  });

  it("reports transmit as the desired state when configured to request transmit on startup", () => {
    const { sink } = createMemorySink();
    const control = createRadarControl({
      config: {
        ...config,
        radarControlMode: "transmit"
      },
      logger: createLogger({ level: "debug", sink })
    });

    expect(control.getStatus()).toMatchObject({
      desiredState: "transmit",
      mode: "transmit"
    });
  });

  it("respects externally observed standby by pausing transmit stay-alive", async () => {
    const { sink } = createMemorySink();
    let observedState: "standby" | "transmit" = "transmit";
    const control = createRadarControl({
      config: {
        ...config,
        radarControlEnabled: true,
        radarControlFallbackHost: "127.0.0.1",
        radarControlHost: "127.0.0.1",
        radarControlMode: "transmit",
        radarControlPort: 56516,
        radarControlStayAliveIntervalMs: 10,
        radarControlWakeHost: "127.0.0.1",
        radarControlWakePort: 56878
      },
      logger: createLogger({ level: "debug", sink }),
      observedStateProvider: () => ({
        observedAt: "2026-06-07T00:00:00.000Z",
        source: "report",
        state: observedState
      }),
      observedStateRequestGraceMs: 0
    });

    try {
      await control.start();
      expect(control.getStatus()).toMatchObject({
        desiredState: "transmit",
        observedState: "transmit"
      });

      observedState = "standby";
      await wait(30);

      expect(control.getStatus()).toMatchObject({
        desiredState: "standby",
        observedState: "standby"
      });
    } finally {
      await control.stop();
    }
  });

  it("does not treat initial inferred standby as an external standby override before transmit is observed", async () => {
    const { sink } = createMemorySink();
    const control = createRadarControl({
      config: {
        ...config,
        radarControlEnabled: true,
        radarControlFallbackHost: "127.0.0.1",
        radarControlHost: "127.0.0.1",
        radarControlMode: "transmit",
        radarControlPort: 56517,
        radarControlStayAliveIntervalMs: 10,
        radarControlWakeHost: "127.0.0.1",
        radarControlWakePort: 56879
      },
      logger: createLogger({ level: "debug", sink }),
      observedStateProvider: () => ({
        observedAt: "2026-06-07T00:00:00.000Z",
        source: "inferred",
        state: "standby"
      }),
      observedStateRequestGraceMs: 0
    });

    try {
      await control.start();
      await wait(30);

      expect(control.getStatus()).toMatchObject({
        desiredState: "transmit",
        observedState: "standby",
        observedStateSource: "inferred"
      });
    } finally {
      await control.stop();
    }
  });
});
