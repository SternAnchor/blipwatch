import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { AddressInfo } from "node:net";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarDiscoveryRadar, RadarDiscoveryStatus } from "./status.js";

export interface RadarDiscovery {
  address(): AddressInfo | undefined;
  getStatus(): RadarDiscoveryStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RadarDiscoveryOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
}

const REPORT_COMMANDS = new Set([0xc4, 0xf5]);
const REPORT_STATUS_NAMES = new Map<number, string>([
  [0x01, "standby"],
  [0x02, "transmit"],
  [0x05, "waking-up"]
]);

export const createRadarDiscovery = ({ config, logger }: RadarDiscoveryOptions): RadarDiscovery => {
  let socket: Socket | undefined;
  let lastReportAt: Date | undefined;
  let lastReportSource: string | undefined;
  let radar: RadarDiscoveryRadar | undefined;
  let reportsReceived = 0;

  return {
    address(): AddressInfo | undefined {
      const currentAddress = socket?.address();
      if (!currentAddress || typeof currentAddress === "string") {
        return undefined;
      }

      return currentAddress;
    },
    getStatus(): RadarDiscoveryStatus {
      const currentAddress = this.address();
      return {
        boundInterface: currentAddress?.address ?? (socket ? config.radarInterface : null),
        enabled: config.radarDiscoveryEnabled,
        lastReportAt: lastReportAt?.toISOString() ?? null,
        lastReportSource: lastReportSource ?? null,
        multicastInterface: getMulticastInterface(config) ?? null,
        multicastGroup: config.radarReportMulticastGroup,
        radar: radar ?? null,
        reportsReceived,
        running: socket !== undefined,
        udpPort: currentAddress?.port ?? (socket ? config.radarReportUdpPort : null)
      };
    },
    async start(): Promise<void> {
      if (!config.radarDiscoveryEnabled) {
        logger.debug("radar discovery start skipped; disabled by configuration");
        return;
      }

      if (socket) {
        logger.debug("radar discovery start skipped; socket already active");
        return;
      }

      socket = createSocket({ reuseAddr: true, type: "udp4" });
      socket.on("message", (data, remote) => {
        reportsReceived += 1;
        lastReportAt = new Date();
        lastReportSource = `${remote.address}:${remote.port}`;
        logger.debug(
          `radar discovery report received count=${reportsReceived} bytes=${data.byteLength} from=${lastReportSource}`
        );

        const parsed = parseNavicoReport({ data: Buffer.from(data), receivedAt: lastReportAt, remote });
        if (!parsed) {
          return;
        }

        radar = mergeRadarReport(radar, parsed);
        if (radar.firstSeenAt === radar.lastSeenAt) {
          logger.info(`Navico radar report detected from ${radar.sourceAddress}:${radar.sourcePort}`);
        }
      });

      socket.on("error", (error) => {
        logger.error("radar discovery socket error", error);
      });

      await new Promise<void>((resolve, reject) => {
        const activeSocket = socket;
        if (!activeSocket) {
          reject(new Error("radar discovery socket was not created"));
          return;
        }

        activeSocket.once("error", reject);
        const bindAddress = "0.0.0.0";
        activeSocket.bind(config.radarReportUdpPort, bindAddress, () => {
          activeSocket.off("error", reject);
          try {
            const multicastInterface = getMulticastInterface(config);
            activeSocket.addMembership(config.radarReportMulticastGroup, multicastInterface);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }

          logger.info(
            `radar discovery listening on ${bindAddress}:${config.radarReportUdpPort} group=${config.radarReportMulticastGroup} multicastInterface=${getMulticastInterface(config) ?? "default"}`
          );
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
            logger.debug(`radar discovery stopped after ${reportsReceived} reports`);
            resolve();
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
  };
};

const getMulticastInterface = (config: BlipWatchConfig): string | undefined => {
  return config.radarInterface === "0.0.0.0" ? undefined : config.radarInterface;
};

interface ParseNavicoReportOptions {
  readonly data: Buffer;
  readonly receivedAt: Date;
  readonly remote: RemoteInfo;
}

export const parseNavicoReport = ({
  data,
  receivedAt,
  remote
}: ParseNavicoReportOptions): RadarDiscoveryRadar | undefined => {
  if (data.byteLength < 2 || !REPORT_COMMANDS.has(data[1] ?? 0)) {
    return undefined;
  }

  const status = data[1] === 0xc4 && data.byteLength >= 3 ? data[2] : undefined;
  const strings = extractPrintableStrings(data);
  const endpointTargets = extractCandidateEndpointTargets(data);
  const endpointAddresses = extractCandidateEndpoints(data);

  return {
    command: `0x${(data[1] ?? 0).toString(16).padStart(2, "0")}`,
    commandEndpoint: selectCommandEndpoint(endpointTargets)?.endpoint ?? null,
    dataEndpoint: endpointAddresses[0] ?? null,
    firstSeenAt: receivedAt.toISOString(),
    lastSeenAt: receivedAt.toISOString(),
    model: strings.find((entry) => /halo|broadband|radar/i.test(entry)) ?? null,
    name: strings[0] ?? null,
    reportType: `0x${(data[0] ?? 0).toString(16).padStart(2, "0")}`,
    serial: strings.find((entry) => /\d{4,}/.test(entry)) ?? null,
    sourceAddress: remote.address,
    sourcePort: remote.port,
    status: status === undefined ? null : `0x${status.toString(16).padStart(2, "0")}`,
    statusName: status === undefined ? null : REPORT_STATUS_NAMES.get(status) ?? "unknown"
  };
};

const mergeRadarReport = (
  current: RadarDiscoveryRadar | undefined,
  next: RadarDiscoveryRadar
): RadarDiscoveryRadar => ({
  ...next,
  commandEndpoint: next.commandEndpoint ?? current?.commandEndpoint ?? null,
  dataEndpoint: next.dataEndpoint ?? current?.dataEndpoint ?? null,
  firstSeenAt: current?.firstSeenAt ?? next.firstSeenAt,
  model: next.model ?? current?.model ?? null,
  name: next.name ?? current?.name ?? null,
  serial: next.serial ?? current?.serial ?? null,
  status: next.status ?? current?.status ?? null,
  statusName: next.statusName ?? current?.statusName ?? null
});

const extractPrintableStrings = (data: Buffer): readonly string[] => {
  const strings: string[] = [];
  let current = "";

  for (const byte of data) {
    if (byte >= 0x20 && byte <= 0x7e) {
      current += String.fromCharCode(byte);
      continue;
    }

    if (current.length >= 3) {
      strings.push(current);
    }
    current = "";
  }

  if (current.length >= 3) {
    strings.push(current);
  }

  return strings;
};

const extractCandidateEndpoints = (data: Buffer): readonly string[] => {
  const endpoints: string[] = [];

  for (let index = 0; index <= data.byteLength - 4; index += 1) {
    const firstOctet = data[index];
    if (firstOctet === undefined || firstOctet < 224 || firstOctet > 239) {
      continue;
    }

    const address = `${data[index]}.${data[index + 1]}.${data[index + 2]}.${data[index + 3]}`;
    endpoints.push(address);
  }

  return endpoints;
};

interface CandidateEndpointTarget {
  readonly endpoint: string;
  readonly host: string;
  readonly port: number;
}

const extractCandidateEndpointTargets = (data: Buffer): readonly CandidateEndpointTarget[] => {
  const endpoints: CandidateEndpointTarget[] = [];

  for (let index = 0; index <= data.byteLength - 6; index += 1) {
    const firstOctet = data[index];
    if (firstOctet === undefined || firstOctet < 224 || firstOctet > 239) {
      continue;
    }

    const host = `${data[index]}.${data[index + 1]}.${data[index + 2]}.${data[index + 3]}`;
    const port = data.readUInt16BE(index + 4);
    if (port <= 0 || port > 10_000) {
      continue;
    }

    endpoints.push({
      endpoint: `${host}:${port}`,
      host,
      port
    });
  }

  return endpoints;
};

const selectCommandEndpoint = (
  endpoints: readonly CandidateEndpointTarget[]
): CandidateEndpointTarget | undefined => {
  return (
    endpoints.find((endpoint) => endpoint.port === 6516) ??
    endpoints.find((endpoint) => endpoint.port !== 6678 && endpoint.port !== 6679 && endpoint.port !== 6878) ??
    endpoints[0]
  );
};
