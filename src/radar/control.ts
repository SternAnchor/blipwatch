import { createSocket, type Socket } from "node:dgram";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarControlStatus, RadarOperatingState, RadarOperatingStateSource } from "./status.js";

export interface RadarControl {
  getStatus(): RadarControlStatus;
  requestStandby(): Promise<void>;
  requestTransmit(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RadarControlOptions {
  readonly commandTargetProvider?: () => CommandTarget | undefined;
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
  readonly observedStateProvider?: () => RadarControlObservedState | undefined;
  readonly observedStateRequestGraceMs?: number;
}

export interface RadarControlObservedState {
  readonly observedAt: string | null;
  readonly source: RadarOperatingStateSource | null;
  readonly state: RadarOperatingState | null;
}

const COMMAND_WAKE = Buffer.from([0x01, 0xb1]);
const COMMAND_TX_ON_A = Buffer.from([0x00, 0xc1, 0x01]);
const COMMAND_TX_ON_B = Buffer.from([0x01, 0xc1, 0x01]);
const COMMAND_TX_OFF_A = Buffer.from([0x00, 0xc1, 0x01]);
const COMMAND_TX_OFF_B = Buffer.from([0x01, 0xc1, 0x00]);
const COMMAND_STAY_ON_A = Buffer.from([0xa0, 0xc1]);
const COMMAND_STAY_ON_B = Buffer.from([0x03, 0xc2]);
const COMMAND_STAY_ON_C = Buffer.from([0x04, 0xc2]);
const COMMAND_STAY_ON_D = Buffer.from([0x05, 0xc2]);
const COMMAND_STAY_ON_E = Buffer.from([0x0a, 0xc2]);
const OBSERVED_STATE_REQUEST_GRACE_MS = 5_000;

type CommandName =
  | "wake"
  | "transmit-off-a"
  | "transmit-off-b"
  | "transmit-on-a"
  | "transmit-on-b"
  | "stay-alive-a"
  | "stay-alive-b"
  | "stay-alive-c"
  | "stay-alive-d"
  | "stay-alive-e";

export const createRadarControl = ({
  commandTargetProvider,
  config,
  logger,
  observedStateProvider,
  observedStateRequestGraceMs = OBSERVED_STATE_REQUEST_GRACE_MS
}: RadarControlOptions): RadarControl => {
  let socket: Socket | undefined;
  let interval: NodeJS.Timeout | undefined;
  let lastCommandAt: Date | undefined;
  let lastCommandName: CommandName | undefined;
  let lastError: string | undefined;
  let lastRequestAt: Date | undefined;
  let lastTransmitOnTarget: string | undefined;
  let hasObservedTransmit = false;
  let commandsSent = 0;
  let stayAliveSequence = 0;
  let desiredState: RadarControlStatus["desiredState"] =
    config.radarControlMode === "transmit" ? "transmit" : "standby";

  const assertSocketActive = (): void => {
    if (!socket) {
      throw new Error("radar control socket is not active");
    }
  };

  const sendCommand = async (name: CommandName, payload: Buffer, target: CommandTarget): Promise<void> => {
    assertSocketActive();

    await new Promise<void>((resolve, reject) => {
      socket?.send(payload, target.port, target.host, (error) => {
        if (error) {
          reject(error);
          return;
        }

        commandsSent += 1;
        lastCommandAt = new Date();
        lastCommandName = name;
        lastError = undefined;
        logger.info(
          `radar control command sent name=${name} bytes=${payload.toString("hex")} target=${target.host}:${target.port} targetSource=${target.source}`
        );
        resolve();
      });
    });
  };

  const sendTransmitOn = async (): Promise<void> => {
    const target = getCommandTarget(config, commandTargetProvider);
    await sendCommand("transmit-on-a", COMMAND_TX_ON_A, target);
    await sendCommand("transmit-on-b", COMMAND_TX_ON_B, target);
    lastTransmitOnTarget = getTargetKey(target);
  };

  const sendTransmitOff = async (): Promise<void> => {
    const target = getCommandTarget(config, commandTargetProvider);
    await sendCommand("transmit-off-a", COMMAND_TX_OFF_A, target);
    await sendCommand("transmit-off-b", COMMAND_TX_OFF_B, target);
    lastTransmitOnTarget = undefined;
  };

  const sendStayAlive = async (): Promise<void> => {
    const target = getCommandTarget(config, commandTargetProvider);
    const sequence = stayAliveSequence;
    stayAliveSequence = (stayAliveSequence + 1) % 4;

    try {
      if (sequence === 0) {
        await sendCommand("stay-alive-a", COMMAND_STAY_ON_A, target);
        await sendCommand("stay-alive-b", COMMAND_STAY_ON_B, target);
        await sendCommand("stay-alive-c", COMMAND_STAY_ON_C, target);
        await sendCommand("stay-alive-d", COMMAND_STAY_ON_D, target);
        await sendCommand("stay-alive-e", COMMAND_STAY_ON_E, target);
        return;
      }

      await sendCommand("stay-alive-a", COMMAND_STAY_ON_A, target);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.error("radar control stay-alive failed", error);
    }
  };

  const sendTransmitCycle = async (): Promise<void> => {
    reconcileObservedState();
    if (desiredState !== "transmit") {
      return;
    }

    const target = getCommandTarget(config, commandTargetProvider);
    if (lastTransmitOnTarget !== getTargetKey(target)) {
      await sendCommand("wake", COMMAND_WAKE, getWakeTarget(config));
      await sendTransmitOn();
    }

    await sendStayAlive();
  };

  const reconcileObservedState = (): void => {
    const observedState = observedStateProvider?.();
    if (observedState?.state === "transmit") {
      hasObservedTransmit = true;
      return;
    }

    if (observedState?.state !== "standby" || desiredState !== "transmit") {
      return;
    }

    if (observedState.source === "inferred" && !hasObservedTransmit) {
      return;
    }

    const requestAgeMs = lastRequestAt ? Date.now() - lastRequestAt.getTime() : Number.POSITIVE_INFINITY;
    if (requestAgeMs < observedStateRequestGraceMs) {
      return;
    }

    desiredState = "standby";
    lastTransmitOnTarget = undefined;
    logger.info("radar control observed external standby; pausing transmit stay-alive");
  };

  const requestStandby = async (): Promise<void> => {
    assertSocketActive();
    desiredState = "standby";
    lastRequestAt = new Date();
    try {
      await sendTransmitOff();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.error("radar control standby request failed", error);
      throw error;
    }
  };

  const requestTransmit = async (): Promise<void> => {
    assertSocketActive();
    desiredState = "transmit";
    lastRequestAt = new Date();
    try {
      await sendCommand("wake", COMMAND_WAKE, getWakeTarget(config));
      await sendTransmitOn();
      await sendStayAlive();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.error("radar control transmit request failed", error);
      throw error;
    }
  };

  return {
    getStatus(): RadarControlStatus {
      const commandTarget = getCommandTarget(config, commandTargetProvider);
      const observedState = observedStateProvider?.();
      return {
        commandTarget: `${commandTarget.host}:${commandTarget.port}`,
        commandTargetSource: commandTarget.source,
        commandsSent,
        desiredState,
        enabled: config.radarControlEnabled,
        lastCommandAt: lastCommandAt?.toISOString() ?? null,
        lastCommandName: lastCommandName ?? null,
        lastError: lastError ?? null,
        lastRequestAt: lastRequestAt?.toISOString() ?? null,
        mode: config.radarControlMode,
        observedState: observedState?.state ?? null,
        observedStateAt: observedState?.observedAt ?? null,
        observedStateSource: observedState?.source ?? null,
        running: socket !== undefined,
        stayAliveIntervalMs: config.radarControlStayAliveIntervalMs,
        wakeTarget: `${config.radarControlWakeHost}:${config.radarControlWakePort}`
      };
    },
    requestStandby,
    requestTransmit,
    async start(): Promise<void> {
      if (!config.radarControlEnabled) {
        logger.debug("radar control start skipped; disabled by configuration");
        return;
      }

      if (socket) {
        logger.debug("radar control start skipped; socket already active");
        return;
      }

      socket = createSocket({ reuseAddr: true, type: "udp4" });
      socket.on("error", (error) => {
        lastError = error.message;
        logger.error("radar control socket error", error);
      });

      await new Promise<void>((resolve, reject) => {
        const activeSocket = socket;
        if (!activeSocket) {
          reject(new Error("radar control socket was not created"));
          return;
        }

        activeSocket.once("error", reject);
        activeSocket.bind(0, config.radarInterface, () => {
          activeSocket.off("error", reject);
          const commandTarget = getCommandTarget(config, commandTargetProvider);
          try {
            activeSocket.setMulticastInterface(config.radarInterface);
          } catch (error) {
            logger.debug(`radar control multicast interface set skipped: ${String(error)}`);
          }
          logger.info(
            `radar control enabled mode=${config.radarControlMode} interface=${config.radarInterface} wakeTarget=${config.radarControlWakeHost}:${config.radarControlWakePort} commandTarget=${commandTarget.host}:${commandTarget.port} commandTargetSource=${commandTarget.source}`
          );
          resolve();
        });
      });

      if (config.radarControlMode === "transmit") {
        await requestTransmit();
      } else {
        await sendCommand("wake", COMMAND_WAKE, getWakeTarget(config));
      }
      interval = setInterval(() => {
        void (async () => {
          try {
            await sendTransmitCycle();
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            logger.error("radar control cycle failed", error);
          }
        })();
      }, config.radarControlStayAliveIntervalMs);
    },
    async stop(): Promise<void> {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }

      if (!socket) {
        return;
      }

      const activeSocket = socket;
      socket = undefined;
      lastTransmitOnTarget = undefined;
      await new Promise<void>((resolve, reject) => {
        try {
          activeSocket.close(() => {
            logger.debug(`radar control stopped after ${commandsSent} commands`);
            resolve();
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
  };
};

const getTargetKey = (target: CommandTarget): string => `${target.host}:${target.port}`;

export interface CommandTarget {
  readonly host: string;
  readonly port: number;
  readonly source: "configured" | "default" | "discovered" | "wake";
}

const getWakeTarget = (config: BlipWatchConfig): CommandTarget => ({
  host: config.radarControlWakeHost,
  port: config.radarControlWakePort,
  source: "wake"
});

const getCommandTarget = (
  config: BlipWatchConfig,
  commandTargetProvider: RadarControlOptions["commandTargetProvider"]
): CommandTarget => {
  if (config.radarControlHost !== "auto") {
    return {
      host: config.radarControlHost,
      port: config.radarControlPort,
      source: "configured"
    };
  }

  const discovered = commandTargetProvider?.();
  if (discovered) {
    return discovered;
  }

  return {
    host: config.radarControlFallbackHost,
    port: config.radarControlPort,
    source: "default"
  };
};

export const navicoControlCommands = {
  stayAlive: [COMMAND_STAY_ON_A, COMMAND_STAY_ON_B, COMMAND_STAY_ON_C, COMMAND_STAY_ON_D, COMMAND_STAY_ON_E],
  transmitOff: [COMMAND_TX_OFF_A, COMMAND_TX_OFF_B],
  transmitOn: [COMMAND_TX_ON_A, COMMAND_TX_ON_B],
  wake: COMMAND_WAKE
} as const satisfies {
  readonly stayAlive: readonly Buffer[];
  readonly transmitOff: readonly Buffer[];
  readonly transmitOn: readonly Buffer[];
  readonly wake: Buffer;
};
