import { EventEmitter } from "node:events";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { AddressInfo } from "node:net";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";

export interface RadarPacket {
  readonly data: Buffer;
  readonly receivedAt: Date;
  readonly remote: RemoteInfo;
}

export interface RadarReceiver {
  address(): AddressInfo | undefined;
  onPacket(listener: (packet: RadarPacket) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RadarReceiverOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

export const createRadarReceiver = ({ config, logger }: RadarReceiverOptions): RadarReceiver => {
  const events = new EventEmitter();
  let socket: Socket | undefined;
  let packetCount = 0;

  return {
    address(): AddressInfo | undefined {
      const currentAddress = socket?.address();
      if (!currentAddress || typeof currentAddress === "string") {
        return undefined;
      }

      return currentAddress;
    },
    onPacket(listener: (packet: RadarPacket) => void): () => void {
      events.on("packet", listener);
      return () => {
        events.off("packet", listener);
      };
    },
    async start(): Promise<void> {
      if (socket) {
        logger.debug("radar receiver start skipped; socket already active");
        return;
      }

      socket = createSocket("udp4");

      socket.on("message", (data, remote) => {
        packetCount += 1;
        logger.debug(
          `radar packet received count=${packetCount} bytes=${data.byteLength} from=${remote.address}:${remote.port}`
        );
        events.emit("packet", {
          data: Buffer.from(data),
          receivedAt: new Date(),
          remote
        });
      });

      socket.on("error", (error) => {
        logger.error("radar receiver socket error", error);
      });

      await new Promise<void>((resolve, reject) => {
        const activeSocket = socket;
        if (!activeSocket) {
          reject(new Error("radar receiver socket was not created"));
          return;
        }

        activeSocket.once("error", reject);
        activeSocket.bind(config.radarUdpPort, config.radarInterface, () => {
          activeSocket.off("error", reject);
          logger.info(`radar receiver listening on ${config.radarInterface}:${config.radarUdpPort}`);
          logger.debug("radar receiver packet diagnostics enabled");
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      if (!socket) {
        return;
      }

      const activeSocket = socket;
      socket = undefined;

      await new Promise<void>((resolve, reject) => {
        try {
          activeSocket.close(() => {
            logger.debug(`radar receiver stopped after ${packetCount} packets`);
            resolve();
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
  };
};
