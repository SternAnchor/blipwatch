import { isIP } from "node:net";

export type LogVerbosity = "debug" | "info";

const DEFAULTS = {
  imageSize: 1024,
  logLevel: "info",
  port: 8080,
  radarInterface: "0.0.0.0",
  radarMulticastGroups: [],
  radarUdpPort: 6678,
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300
} as const;

export interface BlipWatchConfig {
  readonly imageSize: number;
  readonly logLevel: LogVerbosity;
  readonly port: number;
  readonly radarInterface: string;
  readonly radarMulticastGroups: readonly string[];
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
  radarInterface: parseNonEmptyString(env.RADAR_INTERFACE, "RADAR_INTERFACE", DEFAULTS.radarInterface),
  radarMulticastGroups: parseMulticastGroups(env.RADAR_MULTICAST_GROUPS),
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
  if (value === undefined || value.trim().length === 0) {
    return DEFAULTS.radarMulticastGroups;
  }

  return value.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    if (!isIpv4MulticastAddress(entry)) {
      throw new ConfigurationError(`RADAR_MULTICAST_GROUPS must contain IPv4 multicast addresses; received "${entry}"`);
    }

    return entry;
  });
};

const isIpv4MulticastAddress = (value: string): boolean => {
  if (isIP(value) !== 4) {
    return false;
  }

  const firstOctet = Number.parseInt(value.split(".")[0] ?? "", 10);
  return firstOctet >= 224 && firstOctet <= 239;
};
