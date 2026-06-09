import { describe, expect, it } from "vitest";

import { createRadarTargetManager, type RadarTargetLifecycleEventHandler } from "../src/targets/target-manager.js";
import { createLogger } from "../src/logging/logger.js";
import { createMemorySink } from "./support/logger.js";

const createManager = (options: { enabled?: boolean; lostTimeoutSeconds?: number; onEvent?: RadarTargetLifecycleEventHandler } = {}) =>
  createRadarTargetManager({
    config: {
      targetLostTimeoutSeconds: options.lostTimeoutSeconds ?? 10,
      targetTrackingEnabled: options.enabled ?? true
    },
    logger: createLogger({ level: "debug", sink: createMemorySink().sink }),
    onEvent: options.onEvent
  });

describe("createRadarTargetManager", () => {
  it("creates normalized targets and exposes status counts", () => {
    const manager = createManager();
    const target = manager.upsertTarget({
      bearingDegrees: 370,
      confidence: 1.5,
      id: "native-1",
      observedAt: new Date("2026-06-09T00:00:00.000Z"),
      rangeMeters: 1200,
      source: "halo-native"
    });

    expect(target).toEqual({
      bearingDegrees: 10,
      confidence: 1,
      confirmed: false,
      firstSeenAt: "2026-06-09T00:00:00.000Z",
      id: "native-1",
      lastSeenAt: "2026-06-09T00:00:00.000Z",
      rangeMeters: 1200,
      source: "halo-native",
      status: "new"
    });
    const observedAt = new Date("2026-06-09T00:00:00.000Z");
    expect(manager.listTargets(observedAt)).toEqual([target]);
    expect(manager.getStatus(observedAt)).toMatchObject({
      activeCount: 1,
      enabled: true,
      lostCount: 0,
      sourceCounts: {
        "halo-native": 1
      },
      statusCounts: {
        new: 1
      },
      totalCreated: 1,
      totalUpdated: 0
    });
  });

  it("updates, names, confirms, unconfirms, and deletes targets", () => {
    const manager = createManager({ enabled: false });
    manager.upsertTarget({
      bearingDegrees: 42,
      confidence: 0.5,
      id: "manual-1",
      observedAt: new Date("2026-06-09T00:00:00.000Z"),
      rangeMeters: 50,
      source: "manual"
    });

    expect(manager.renameTarget("manual-1", " Ferry ")).toMatchObject({ name: "Ferry" });
    expect(manager.confirmTarget("manual-1")).toMatchObject({ confirmed: true });
    expect(manager.unconfirmTarget("manual-1")).toMatchObject({ confirmed: false });
    expect(
      manager.upsertTarget({
        bearingDegrees: -10,
        confidence: -1,
        id: "manual-1",
        observedAt: new Date("2026-06-09T00:00:01.000Z"),
        rangeMeters: -50,
        source: "manual"
      })
    ).toMatchObject({
      bearingDegrees: 350,
      confidence: 0,
      firstSeenAt: "2026-06-09T00:00:00.000Z",
      lastSeenAt: "2026-06-09T00:00:01.000Z",
      rangeMeters: 0,
      status: "tracking"
    });

    expect(manager.getStatus()).toMatchObject({
      enabled: false,
      totalCreated: 1,
      totalUpdated: 4
    });
    expect(manager.deleteTarget("manual-1")).toBe(true);
    expect(manager.deleteTarget("manual-1")).toBe(false);
    expect(manager.getStatus()).toMatchObject({
      activeCount: 0,
      deletedCount: 1
    });
  });

  it("emits lifecycle events for target changes", () => {
    const events: unknown[] = [];
    const manager = createManager({
      lostTimeoutSeconds: 1,
      onEvent: (event) => events.push(event)
    });
    manager.upsertTarget({
      bearingDegrees: 42,
      confidence: 0.5,
      id: "manual-1",
      observedAt: new Date("2026-06-09T00:00:00.000Z"),
      rangeMeters: 50,
      source: "manual"
    });
    manager.upsertTarget({
      bearingDegrees: 43,
      confidence: 0.6,
      id: "manual-1",
      observedAt: new Date("2026-06-09T00:00:01.000Z"),
      rangeMeters: 60,
      source: "manual"
    });
    manager.renameTarget("manual-1", "Ferry");
    manager.confirmTarget("manual-1");
    manager.unconfirmTarget("manual-1");
    manager.getStatus(new Date("2026-06-09T00:00:03.000Z"));
    manager.deleteTarget("manual-1");

    expect(events).toMatchObject([
      {
        target: {
          id: "manual-1",
          status: "new"
        },
        targetId: "manual-1",
        type: "created"
      },
      {
        previousTarget: {
          status: "new"
        },
        target: {
          rangeMeters: 60,
          status: "tracking"
        },
        targetId: "manual-1",
        type: "updated"
      },
      {
        target: {
          name: "Ferry"
        },
        targetId: "manual-1",
        type: "renamed"
      },
      {
        target: {
          confirmed: true
        },
        targetId: "manual-1",
        type: "confirmed"
      },
      {
        target: {
          confirmed: false
        },
        targetId: "manual-1",
        type: "unconfirmed"
      },
      {
        previousTarget: {
          status: "tracking"
        },
        target: {
          status: "lost"
        },
        targetId: "manual-1",
        type: "lost"
      },
      {
        previousTarget: {
          id: "manual-1"
        },
        targetId: "manual-1",
        type: "deleted"
      }
    ]);
  });

  it("marks stale targets lost after the configured timeout", () => {
    const { messages, sink } = createMemorySink();
    const manager = createRadarTargetManager({
      config: {
        targetLostTimeoutSeconds: 2,
        targetTrackingEnabled: true
      },
      logger: createLogger({ level: "debug", sink })
    });
    manager.upsertTarget({
      bearingDegrees: 90,
      confidence: 0.8,
      id: "detected-1",
      observedAt: new Date("2026-06-09T00:00:00.000Z"),
      rangeMeters: 900,
      source: "blipwatch-detected"
    });

    expect(manager.getStatus(new Date("2026-06-09T00:00:02.000Z"))).toMatchObject({
      activeCount: 1,
      lostCount: 0
    });
    expect(manager.getTarget("detected-1", new Date("2026-06-09T00:00:03.000Z"))).toMatchObject({
      status: "lost"
    });
    expect(manager.getStatus()).toMatchObject({
      activeCount: 0,
      lostCount: 1
    });
    expect(messages.some((message) => message.includes("radar target marked lost id=detected-1"))).toBe(true);
  });
});
