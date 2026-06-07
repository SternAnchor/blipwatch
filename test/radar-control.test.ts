import { describe, expect, it } from "vitest";

import { navicoControlCommands } from "../src/radar/control.js";

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
});
