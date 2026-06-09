import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";

export type RadarTargetSource = "ais" | "blipwatch-detected" | "halo-native" | "manual";
export type RadarTargetStatus = "lost" | "new" | "tracking";
export type RadarTargetLifecycleEventType =
  | "confirmed"
  | "created"
  | "deleted"
  | "lost"
  | "renamed"
  | "unconfirmed"
  | "updated";

export interface RadarTarget {
  readonly bearingDegrees: number;
  readonly confidence: number;
  readonly confirmed: boolean;
  readonly firstSeenAt: string;
  readonly id: string;
  readonly lastSeenAt: string;
  readonly name?: string;
  readonly rangeMeters: number;
  readonly source: RadarTargetSource;
  readonly status: RadarTargetStatus;
}

export interface RadarTargetObservation {
  readonly bearingDegrees: number;
  readonly confidence: number;
  readonly id?: string;
  readonly name?: string;
  readonly observedAt?: Date;
  readonly rangeMeters: number;
  readonly source: RadarTargetSource;
}

export interface RadarTargetLifecycleEvent {
  readonly at: string;
  readonly previousTarget?: RadarTarget;
  readonly target?: RadarTarget;
  readonly targetId: string;
  readonly type: RadarTargetLifecycleEventType;
}

export type RadarTargetLifecycleEventHandler = (event: RadarTargetLifecycleEvent) => void;

export interface RadarTargetManager {
  confirmTarget(id: string): RadarTarget | undefined;
  deleteTarget(id: string): boolean;
  getStatus(now?: Date): RadarTargetManagerStatus;
  getTarget(id: string, now?: Date): RadarTarget | undefined;
  listTargets(now?: Date): readonly RadarTarget[];
  renameTarget(id: string, name: string | undefined): RadarTarget | undefined;
  unconfirmTarget(id: string): RadarTarget | undefined;
  upsertTarget(observation: RadarTargetObservation): RadarTarget;
}

export interface RadarTargetManagerStatus {
  readonly activeCount: number;
  readonly deletedCount: number;
  readonly enabled: boolean;
  readonly lostCount: number;
  readonly lostTimeoutSeconds: number;
  readonly sourceCounts: Record<RadarTargetSource, number>;
  readonly statusCounts: Record<RadarTargetStatus, number>;
  readonly totalCreated: number;
  readonly totalUpdated: number;
}

interface RadarTargetManagerOptions {
  readonly config: Pick<BlipWatchConfig, "targetLostTimeoutSeconds" | "targetTrackingEnabled">;
  readonly logger: Logger;
  readonly onEvent?: RadarTargetLifecycleEventHandler;
}

const TARGET_SOURCES: readonly RadarTargetSource[] = ["ais", "blipwatch-detected", "halo-native", "manual"];
const TARGET_STATUSES: readonly RadarTargetStatus[] = ["lost", "new", "tracking"];

export const createRadarTargetManager = ({ config, logger, onEvent }: RadarTargetManagerOptions): RadarTargetManager => {
  const targets = new Map<string, RadarTarget>();
  let deletedCount = 0;
  let sequence = 0;
  let totalCreated = 0;
  let totalUpdated = 0;

  const markLostTargets = (now = new Date()): void => {
    const lostAfterMs = config.targetLostTimeoutSeconds * 1000;
    for (const target of targets.values()) {
      if (target.status === "lost") {
        continue;
      }

      const ageMs = now.getTime() - new Date(target.lastSeenAt).getTime();
      if (ageMs > lostAfterMs) {
        const updated = {
          ...target,
          status: "lost"
        } as const;
        targets.set(target.id, updated);
        onEvent?.({
          at: now.toISOString(),
          previousTarget: target,
          target: updated,
          targetId: target.id,
          type: "lost"
        });
        logger.debug(`radar target marked lost id=${target.id} source=${target.source}`);
      }
    }
  };

  const getCounts = (): Pick<RadarTargetManagerStatus, "sourceCounts" | "statusCounts"> => {
    const sourceCounts = Object.fromEntries(TARGET_SOURCES.map((source) => [source, 0])) as Record<RadarTargetSource, number>;
    const statusCounts = Object.fromEntries(TARGET_STATUSES.map((status) => [status, 0])) as Record<RadarTargetStatus, number>;

    for (const target of targets.values()) {
      sourceCounts[target.source] += 1;
      statusCounts[target.status] += 1;
    }

    return { sourceCounts, statusCounts };
  };

  return {
    confirmTarget(id: string): RadarTarget | undefined {
      const target = targets.get(id);
      if (!target) {
        return undefined;
      }

      const updated = { ...target, confirmed: true };
      targets.set(id, updated);
      totalUpdated += 1;
      emitTargetEvent(onEvent, "confirmed", updated, target);
      return updated;
    },
    deleteTarget(id: string): boolean {
      const target = targets.get(id);
      const deleted = targets.delete(id);
      if (deleted) {
        deletedCount += 1;
        if (target) {
          onEvent?.({
            at: new Date().toISOString(),
            previousTarget: target,
            targetId: id,
            type: "deleted"
          });
        }
        logger.debug(`radar target deleted id=${id}`);
      }

      return deleted;
    },
    getStatus(now = new Date()): RadarTargetManagerStatus {
      markLostTargets(now);
      const counts = getCounts();
      return {
        activeCount: targets.size - counts.statusCounts.lost,
        deletedCount,
        enabled: config.targetTrackingEnabled,
        lostCount: counts.statusCounts.lost,
        lostTimeoutSeconds: config.targetLostTimeoutSeconds,
        sourceCounts: counts.sourceCounts,
        statusCounts: counts.statusCounts,
        totalCreated,
        totalUpdated
      };
    },
    getTarget(id: string, now = new Date()): RadarTarget | undefined {
      markLostTargets(now);
      return targets.get(id);
    },
    listTargets(now = new Date()): readonly RadarTarget[] {
      markLostTargets(now);
      return [...targets.values()].sort((left, right) => left.id.localeCompare(right.id));
    },
    renameTarget(id: string, name: string | undefined): RadarTarget | undefined {
      const target = targets.get(id);
      if (!target) {
        return undefined;
      }

      const trimmed = name?.trim();
      const updated = trimmed
        ? { ...target, name: trimmed }
        : withoutName(target);
      targets.set(id, updated);
      totalUpdated += 1;
      emitTargetEvent(onEvent, "renamed", updated, target);
      return updated;
    },
    unconfirmTarget(id: string): RadarTarget | undefined {
      const target = targets.get(id);
      if (!target) {
        return undefined;
      }

      const updated = { ...target, confirmed: false };
      targets.set(id, updated);
      totalUpdated += 1;
      emitTargetEvent(onEvent, "unconfirmed", updated, target);
      return updated;
    },
    upsertTarget(observation: RadarTargetObservation): RadarTarget {
      const now = observation.observedAt ?? new Date();
      const id = observation.id ?? `${observation.source}-${++sequence}`;
      const existing = targets.get(id);
      const target: RadarTarget = {
        bearingDegrees: normalizeBearing(observation.bearingDegrees),
        confidence: clampConfidence(observation.confidence),
        confirmed: existing?.confirmed ?? false,
        firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
        id,
        lastSeenAt: now.toISOString(),
        name: observation.name ?? existing?.name,
        rangeMeters: Math.max(0, observation.rangeMeters),
        source: observation.source,
        status: existing ? "tracking" : "new"
      };
      targets.set(id, target);
      if (existing) {
        totalUpdated += 1;
        emitTargetEvent(onEvent, "updated", target, existing);
      } else {
        totalCreated += 1;
        emitTargetEvent(onEvent, "created", target);
      }

      return target;
    }
  };
};

const emitTargetEvent = (
  onEvent: RadarTargetLifecycleEventHandler | undefined,
  type: RadarTargetLifecycleEventType,
  target: RadarTarget,
  previousTarget?: RadarTarget
): void => {
  onEvent?.({
    at: new Date().toISOString(),
    ...(previousTarget ? { previousTarget } : {}),
    target,
    targetId: target.id,
    type
  });
};

const withoutName = (target: RadarTarget): RadarTarget => {
  const copy = { ...target };
  delete copy.name;
  return copy;
};

const clampConfidence = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeBearing = (value: number): number => {
  const bearing = value % 360;
  return bearing < 0 ? bearing + 360 : bearing;
};
