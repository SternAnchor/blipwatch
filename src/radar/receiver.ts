import { EventEmitter } from "node:events";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { AddressInfo } from "node:net";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarReceiverStatus } from "./status.js";

export interface RadarPacket {
  readonly data: Buffer;
  readonly receivedAt: Date;
  readonly remote: RemoteInfo;
}

export interface RadarReceiver {
  address(): AddressInfo | undefined;
  getStatus(): RadarReceiverStatus;
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
  let lastPacketAt: Date | undefined;
  let lastSourceAddress: string | undefined;
  let packetCount = 0;

  return {
    address(): AddressInfo | undefined {
      const currentAddress = socket?.address();
      if (!currentAddress || typeof currentAddress === "string") {
        return undefined;
      }

      return currentAddress;
    },
    getStatus(): RadarReceiverStatus {
      const currentAddress = this.address();
      return {
        boundInterface: currentAddress?.address ?? (socket ? config.radarInterface : null),
        lastPacketAt: lastPacketAt?.toISOString() ?? null,
        lastSourceAddress: lastSourceAddress ?? null,
        multicastInterface: getMulticastInterface(config) ?? null,
        multicastGroups: config.radarMulticastGroups,
        packetsReceived: packetCount,
        running: socket !== undefined,
        udpPort: currentAddress?.port ?? (socket ? config.radarUdpPort : null)
      };
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

      socket = createSocket({ reuseAddr: true, type: "udp4" });

      socket.on("message", (data, remote) => {
        packetCount += 1;
        lastPacketAt = new Date();
        lastSourceAddress = `${remote.address}:${remote.port}`;
        logger.debug(
          `radar packet received count=${packetCount} bytes=${data.byteLength} from=${remote.address}:${remote.port}`
        );
        events.emit("packet", {
          data: Buffer.from(data),
          receivedAt: lastPacketAt,
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
        const bindAddress = getBindAddress(config);
        activeSocket.bind(config.radarUdpPort, bindAddress, () => {
          activeSocket.off("error", reject);
          try {
            joinConfiguredMulticastGroups(activeSocket, config, logger);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }

          logger.info(
            `radar receiver listening on ${bindAddress}:${config.radarUdpPort} multicastInterface=${getMulticastInterface(config) ?? "default"}`
          );
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

const joinConfiguredMulticastGroups = (socket: Socket, config: BlipWatchConfig, logger: Logger): void => {
  for (const group of config.radarMulticastGroups) {
    const multicastInterface = getMulticastInterface(config);
    socket.addMembership(group, multicastInterface);
    logger.info(`radar receiver joined multicast group ${group} interface=${multicastInterface ?? "default"}`);
  }
};

const getBindAddress = (config: BlipWatchConfig): string => {
  return config.radarMulticastGroups.length > 0 ? "0.0.0.0" : config.radarInterface;
};

const getMulticastInterface = (config: BlipWatchConfig): string | undefined => {
  return config.radarInterface === "0.0.0.0" ? undefined : config.radarInterface;
};
