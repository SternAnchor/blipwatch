import { createSocket, type Socket } from "node:dgram";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarControlStatus } from "./status.js";

export interface RadarControl {
  getStatus(): RadarControlStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RadarControlOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

const COMMAND_WAKE = Buffer.from([0x01, 0xb1]);
const COMMAND_TX_ON_A = Buffer.from([0x00, 0xc1, 0x01]);
const COMMAND_TX_ON_B = Buffer.from([0x01, 0xc1, 0x01]);
const COMMAND_STAY_ON_A = Buffer.from([0xa0, 0xc1]);
const COMMAND_STAY_ON_B = Buffer.from([0x03, 0xc2]);
const COMMAND_STAY_ON_C = Buffer.from([0x04, 0xc2]);
const COMMAND_STAY_ON_D = Buffer.from([0x05, 0xc2]);
const COMMAND_STAY_ON_E = Buffer.from([0x0a, 0xc2]);

type CommandName =
  | "wake"
  | "transmit-on-a"
  | "transmit-on-b"
  | "stay-alive-a"
  | "stay-alive-b"
  | "stay-alive-c"
  | "stay-alive-d"
  | "stay-alive-e";

export const createRadarControl = ({ config, logger }: RadarControlOptions): RadarControl => {
  let socket: Socket | undefined;
  let interval: NodeJS.Timeout | undefined;
  let lastCommandAt: Date | undefined;
  let lastCommandName: CommandName | undefined;
  let lastError: string | undefined;
  let commandsSent = 0;
  let stayAliveSequence = 0;

  const sendCommand = async (name: CommandName, payload: Buffer, target: CommandTarget): Promise<void> => {
    if (!socket) {
      throw new Error("radar control socket is not active");
    }

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
          `radar control command sent name=${name} bytes=${payload.toString("hex")} target=${target.host}:${target.port}`
        );
        resolve();
      });
    });
  };

  const sendStayAlive = async (): Promise<void> => {
    const target = getCommandTarget(config);
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

  return {
    getStatus(): RadarControlStatus {
      return {
        commandTarget: `${config.radarControlHost}:${config.radarControlPort}`,
        commandsSent,
        enabled: config.radarControlEnabled,
        lastCommandAt: lastCommandAt?.toISOString() ?? null,
        lastCommandName: lastCommandName ?? null,
        lastError: lastError ?? null,
        mode: config.radarControlMode,
        running: socket !== undefined,
        stayAliveIntervalMs: config.radarControlStayAliveIntervalMs,
        wakeTarget: `${config.radarControlWakeHost}:${config.radarControlWakePort}`
      };
    },
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
          try {
            activeSocket.setMulticastInterface(config.radarInterface);
          } catch (error) {
            logger.debug(`radar control multicast interface set skipped: ${String(error)}`);
          }
          logger.info(
            `radar control enabled mode=${config.radarControlMode} interface=${config.radarInterface} wakeTarget=${config.radarControlWakeHost}:${config.radarControlWakePort} commandTarget=${config.radarControlHost}:${config.radarControlPort}`
          );
          resolve();
        });
      });

      await sendCommand("wake", COMMAND_WAKE, getWakeTarget(config));
      if (config.radarControlMode === "transmit") {
        await sendCommand("transmit-on-a", COMMAND_TX_ON_A, getCommandTarget(config));
        await sendCommand("transmit-on-b", COMMAND_TX_ON_B, getCommandTarget(config));
        await sendStayAlive();
        interval = setInterval(() => {
          void sendStayAlive();
        }, config.radarControlStayAliveIntervalMs);
      }
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

interface CommandTarget {
  readonly host: string;
  readonly port: number;
}

const getWakeTarget = (config: BlipWatchConfig): CommandTarget => ({
  host: config.radarControlWakeHost,
  port: config.radarControlWakePort
});

const getCommandTarget = (config: BlipWatchConfig): CommandTarget => ({
  host: config.radarControlHost,
  port: config.radarControlPort
});

export const navicoControlCommands = {
  stayAlive: [COMMAND_STAY_ON_A, COMMAND_STAY_ON_B, COMMAND_STAY_ON_C, COMMAND_STAY_ON_D, COMMAND_STAY_ON_E],
  transmitOn: [COMMAND_TX_ON_A, COMMAND_TX_ON_B],
  wake: COMMAND_WAKE
} as const satisfies {
  readonly stayAlive: readonly Buffer[];
  readonly transmitOn: readonly Buffer[];
  readonly wake: Buffer;
};
