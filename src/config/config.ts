import { isIP } from "node:net";

export type LogVerbosity = "debug" | "info";

const DEFAULTS = {
  imageSize: 1024,
  logLevel: "info",
  port: 8080,
  radarDiscoveryEnabled: true,
  radarInterface: "auto",
  radarMulticastGroups: ["236.6.7.8"],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 6878,
  radarUdpPort: 6678,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300
} as const;

export interface BlipWatchConfig {
  readonly imageSize: number;
  readonly logLevel: LogVerbosity;
  readonly port: number;
  readonly radarDiscoveryEnabled: boolean;
  readonly radarInterface: string;
  readonly radarMulticastGroups: readonly string[];
  readonly radarReportMulticastGroup: string;
  readonly radarReportUdpPort: number;
  readonly radarUdpPort: number;
  readonly replayFrameIntervalMs: number;
  readonly replayRetentionSeconds: number;
}

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export const loadConfig = (env: NodeJS.ProcessEnv): BlipWatchConfig => ({
  imageSize: parsePositiveInteger(env.IMAGE_SIZE, "IMAGE_SIZE", DEFAULTS.imageSize),
  logLevel: parseLogLevel(env.LOG_LEVEL),
  port: parsePort(env.PORT, "PORT", DEFAULTS.port),
  radarDiscoveryEnabled: parseBoolean(env.RADAR_DISCOVERY_ENABLED, "RADAR_DISCOVERY_ENABLED", DEFAULTS.radarDiscoveryEnabled),
  radarInterface: parseNonEmptyString(env.RADAR_INTERFACE, "RADAR_INTERFACE", DEFAULTS.radarInterface),
  radarMulticastGroups: parseMulticastGroups(env.RADAR_MULTICAST_GROUPS),
  radarReportMulticastGroup: parseMulticastGroup(
    env.RADAR_REPORT_MULTICAST_GROUP,
    "RADAR_REPORT_MULTICAST_GROUP",
    DEFAULTS.radarReportMulticastGroup
  ),
  radarReportUdpPort: parsePort(env.RADAR_REPORT_UDP_PORT, "RADAR_REPORT_UDP_PORT", DEFAULTS.radarReportUdpPort),
  radarUdpPort: parsePort(env.RADAR_UDP_PORT, "RADAR_UDP_PORT", DEFAULTS.radarUdpPort),
  replayFrameIntervalMs: parsePositiveInteger(
    env.REPLAY_FRAME_INTERVAL_MS,
    "REPLAY_FRAME_INTERVAL_MS",
    DEFAULTS.replayFrameIntervalMs
  ),
  replayRetentionSeconds: parsePositiveInteger(
    env.REPLAY_RETENTION_SECONDS,
    "REPLAY_RETENTION_SECONDS",
    DEFAULTS.replayRetentionSeconds
  )
});

const parseBoolean = (value: string | undefined, name: string, defaultValue: boolean): boolean => {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new ConfigurationError(`${name} must be one of: true, false, 1, 0; received "${value}"`);
};

const parsePositiveInteger = (value: string | undefined, name: string, defaultValue: number): number => {
  const parsed = parseInteger(value, name, defaultValue);
  if (parsed <= 0) {
    throw new ConfigurationError(`${name} must be greater than 0; received ${parsed}`);
  }

  return parsed;
};

const parsePort = (value: string | undefined, name: string, defaultValue: number): number => {
  const parsed = parseInteger(value, name, defaultValue);
  if (parsed < 0 || parsed > 65535) {
    throw new ConfigurationError(`${name} must be between 0 and 65535; received ${parsed}`);
  }

  return parsed;
};

const parseInteger = (value: string | undefined, name: string, defaultValue: number): number => {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new ConfigurationError(`${name} must be an integer; received "${value}"`);
  }

  return Number.parseInt(value, 10);
};

const parseLogLevel = (value: string | undefined): LogVerbosity => {
  if (value === undefined || value === "") {
    return DEFAULTS.logLevel;
  }

  if (value === "debug" || value === "info") {
    return value;
  }

  throw new ConfigurationError(`LOG_LEVEL must be one of: debug, info; received "${value}"`);
};

const parseNonEmptyString = (value: string | undefined, name: string, defaultValue: string): string => {
  if (value === undefined) {
    return defaultValue;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConfigurationError(`${name} must not be empty`);
  }

  return trimmed;
};

const parseMulticastGroups = (value: string | undefined): readonly string[] => {
  if (value === undefined) {
    return DEFAULTS.radarMulticastGroups;
  }

  if (value.trim().length === 0) {
    return [];
  }

  return value.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    return parseMulticastGroup(entry, "RADAR_MULTICAST_GROUPS", entry);
  });
};

const parseMulticastGroup = (value: string | undefined, name: string, defaultValue: string): string => {
  const parsed = parseNonEmptyString(value, name, defaultValue);
  if (!isIpv4MulticastAddress(parsed)) {
    throw new ConfigurationError(`${name} must contain an IPv4 multicast address; received "${parsed}"`);
  }

  return parsed;
};

const isIpv4MulticastAddress = (value: string): boolean => {
  if (isIP(value) !== 4) {
    return false;
  }

  const firstOctet = Number.parseInt(value.split(".")[0] ?? "", 10);
  return firstOctet >= 224 && firstOctet <= 239;
};
