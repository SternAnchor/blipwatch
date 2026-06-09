import { createSocket, type Socket } from "node:dgram";

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
  headless: true,
  imageSize: 1024,
  logLevel: "debug",
  openBrowser: false,
  port: 8080,
  portFallbackEnabled: true,
  portFallbackMaxAttempts: 5,
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

const bindUdpSocket = async (): Promise<Socket> => {
  const socket = createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", () => {
      socket.off("error", reject);
      resolve();
    });
  });
  return socket;
};

const readUdpPayload = async (socket: Socket): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("message", (message) => {
      socket.off("error", reject);
      resolve(Buffer.from(message));
    });
  });

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

  it("builds documented Navico tuning and range payloads", () => {
    expect(navicoControlCommands.buildRange(1000).toString("hex")).toBe("03c110270000");
    expect(navicoControlCommands.buildGain({ mode: "manual", value: 42 }).toString("hex")).toBe("06c100000000000000006d");
    expect(navicoControlCommands.buildGain({ mode: "auto" }).toString("hex")).toBe("06c1000000000100000000");
    expect(navicoControlCommands.buildRainClutter({ mode: "manual", value: 12 }).toString("hex")).toBe(
      "06c1040000000000000021"
    );
    expect(navicoControlCommands.buildRainClutter({ mode: "auto" }).toString("hex")).toBe("06c1040000000100000000");
    expect(navicoControlCommands.buildSeaClutter({ mode: "manual", value: 50 }).map((command) => command.toString("hex"))).toEqual([
      "11c100000001",
      "11c100323202"
    ]);
    expect(navicoControlCommands.buildSeaClutter({ mode: "auto" }).map((command) => command.toString("hex"))).toEqual([
      "11c101000001",
      "11c101000004"
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
          supported: true
        },
        rainClutter: {
          supported: true
        },
        range: {
          supported: true
        },
        seaClutter: {
          supported: true
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

  it("requires an active control socket before sending tuning commands", async () => {
    const { sink } = createMemorySink();
    const control = createRadarControl({
      config,
      logger: createLogger({ level: "debug", sink })
    });

    await expect(control.requestGain({ mode: "manual", value: 42 })).rejects.toThrow("radar control socket is not active");
    await expect(control.requestSeaClutter({ mode: "auto" })).rejects.toThrow("radar control socket is not active");
    await expect(control.requestRainClutter({ mode: "manual", value: 12 })).rejects.toThrow(
      "radar control socket is not active"
    );
    await expect(control.requestRange({ rangeMeters: 463 })).rejects.toThrow("radar control socket is not active");

    expect(control.getStatus()).toMatchObject({
      commandsSent: 0
    });
  });

  it("sends tuning requests through the active command target", async () => {
    const commandSocket = await bindUdpSocket();
    const commandPort = (commandSocket.address() as { port: number }).port;
    const { sink } = createMemorySink();
    const control = createRadarControl({
      config: {
        ...config,
        radarControlEnabled: true,
        radarControlFallbackHost: "127.0.0.1",
        radarControlHost: "127.0.0.1",
        radarControlPort: commandPort,
        radarControlWakeHost: "127.0.0.1",
        radarControlWakePort: commandPort + 1
      },
      logger: createLogger({ level: "debug", sink })
    });

    try {
      await control.start();
      const nextPayload = readUdpPayload(commandSocket);
      await expect(control.requestGain({ mode: "manual", value: 42 })).resolves.toMatchObject({
        ok: true,
        setting: "gain",
        supported: true
      });

      await expect(nextPayload).resolves.toEqual(navicoControlCommands.buildGain({ mode: "manual", value: 42 }));
      expect(control.getStatus()).toMatchObject({
        tuning: {
          gain: {
            lastError: null,
            mode: "manual",
            value: 42
          }
        }
      });
    } finally {
      commandSocket.close();
      await control.stop();
    }
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

  it("keeps transmit requested when standby is only inferred after active traffic", async () => {
    const { sink } = createMemorySink();
    let observedState: {
      observedAt: string;
      source: "inferred" | "traffic";
      state: "standby" | "transmit";
    } = {
      observedAt: "2026-06-07T00:00:00.000Z",
      source: "traffic",
      state: "transmit"
    };
    const control = createRadarControl({
      config: {
        ...config,
        radarControlEnabled: true,
        radarControlFallbackHost: "127.0.0.1",
        radarControlHost: "127.0.0.1",
        radarControlMode: "transmit",
        radarControlPort: 56518,
        radarControlStayAliveIntervalMs: 10,
        radarControlWakeHost: "127.0.0.1",
        radarControlWakePort: 56880
      },
      logger: createLogger({ level: "debug", sink }),
      observedStateProvider: () => observedState,
      observedStateRequestGraceMs: 0
    });

    try {
      await control.start();
      const commandsAfterStart = control.getStatus().commandsSent;
      observedState = {
        observedAt: "2026-06-07T00:00:10.000Z",
        source: "inferred",
        state: "standby"
      };
      await wait(30);

      expect(control.getStatus()).toMatchObject({
        desiredState: "transmit",
        observedState: "standby",
        observedStateSource: "inferred"
      });
      expect(control.getStatus().commandsSent).toBeGreaterThan(commandsAfterStart);
    } finally {
      await control.stop();
    }
  });
});
