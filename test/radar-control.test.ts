import { describe, expect, it } from "vitest";

import type { BlipWatchConfig } from "../src/config/config.js";
import { createLogger } from "../src/logging/logger.js";
import { createRadarControl, navicoControlCommands } from "../src/radar/control.js";
import { createMemorySink } from "./support/logger.js";

const config: BlipWatchConfig = {
  imageSize: 1024,
  logLevel: "debug",
  port: 8080,
  radarControlEnabled: false,
  radarControlFallbackHost: "236.6.8.36",
  radarControlHost: "auto",
  radarControlMode: "wake",
  radarControlPort: 6516,
  radarControlStayAliveIntervalMs: 1000,
  radarControlWakeHost: "236.6.7.5",
  radarControlWakePort: 6878,
  radarDiscoveryEnabled: false,
  radarInterface: "127.0.0.1",
  radarMulticastGroups: [],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 0,
  radarUdpPort: 0,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300
};

describe("Navico radar control commands", () => {
  it("keeps the documented wake, transmit, and stay-alive byte sequences stable", () => {
    expect(navicoControlCommands.wake.toString("hex")).toBe("01b1");
    expect(navicoControlCommands.transmitOn.map((command) => command.toString("hex"))).toEqual(["00c101", "01c101"]);
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
      logger: createLogger({ level: "debug", sink })
    });

    expect(control.getStatus()).toMatchObject({
      commandTarget: "236.6.8.99:6517",
      commandTargetSource: "discovered"
    });
  });
});
