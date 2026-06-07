import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/config.js";

describe("loadConfig", () => {
  it("uses v0.01 defaults", () => {
    expect(loadConfig({})).toEqual({
      imageSize: 1024,
      logLevel: "info",
      port: 8080,
      radarInterface: "0.0.0.0",
      radarUdpPort: 6678,
      replayFrameIntervalMs: 1000,
      replayRetentionSeconds: 300
    });
  });

  it("enables debug logging", () => {
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
  });
});
