import { isIP } from "node:net";

export type LogVerbosity = "debug" | "info";
export type RadarControlMode = "wake" | "transmit";
export type RadarRenderPalette = "chartplotter" | "grayscale" | "green";

const DEFAULTS = {
  calibrationCaptureDirectory: "captures/calibration",
  calibrationCaptureEnabled: false,
  calibrationCaptureIntervalMs: 10_000,
  calibrationCapturePacketLimit: 250,
  headless: false,
  imageSize: 1024,
  logLevel: "info",
  openBrowser: true,
  port: 8080,
  portFallbackEnabled: true,
  portFallbackMaxAttempts: 5,
  radarBrightnessScale: 100,
  radarControlEnabled: true,
  radarControlFallbackHost: "236.6.8.36",
  radarControlHost: "auto",
  radarControlMode: "wake",
  radarControlPort: 6516,
  radarControlStayAliveIntervalMs: 1000,
  radarControlWakeHost: "236.6.7.5",
  radarControlWakePort: 6878,
  radarDiscoveryEnabled: true,
  radarDisplayRangeMeters: "auto",
  radarInterface: "auto",
  radarMulticastGroups: ["236.6.7.8"],
  radarReportMulticastGroup: "236.6.7.5",
  radarReportUdpPort: 6878,
  radarRenderPalette: "chartplotter",
  radarTargetFadeMs: 8_000,
  radarTargetExpansion: 100,
  radarTargetMaxAgeMs: 15_000,
  radarTargetPersistenceMs: 4_000,
  radarUdpPort: 6678,
  rawRecordingDirectory: "captures/recordings",
  replayFrameIntervalMs: 1000,
  replayRetentionSeconds: 300,
  targetLostTimeoutSeconds: 10,
  targetTrackingEnabled: true
} as const;

export interface BlipWatchConfig {
  readonly calibrationCaptureDirectory: string;
  readonly calibrationCaptureEnabled: boolean;
  readonly calibrationCaptureIntervalMs: number;
  readonly calibrationCapturePacketLimit: number;
  readonly headless: boolean;
  readonly imageSize: number;
  readonly logLevel: LogVerbosity;
  readonly openBrowser: boolean;
  readonly port: number;
  readonly portFallbackEnabled: boolean;
  readonly portFallbackMaxAttempts: number;
  readonly radarBrightnessScale: number;
  readonly radarControlEnabled: boolean;
  readonly radarControlFallbackHost: string;
  readonly radarControlHost: string;
  readonly radarControlMode: RadarControlMode;
  readonly radarControlPort: number;
  readonly radarControlStayAliveIntervalMs: number;
  readonly radarControlWakeHost: string;
  readonly radarControlWakePort: number;
  readonly radarDiscoveryEnabled: boolean;
  readonly radarDisplayRangeMeters: number | "auto";
  readonly radarInterface: string;
  readonly radarMulticastGroups: readonly string[];
  readonly radarReportMulticastGroup: string;
  readonly radarReportUdpPort: number;
  readonly radarRenderPalette: RadarRenderPalette;
  readonly radarTargetFadeMs: number;
  readonly radarTargetExpansion: number;
  readonly radarTargetMaxAgeMs: number;
  readonly radarTargetPersistenceMs: number;
  readonly radarUdpPort: number;
  readonly rawRecordingDirectory: string;
  readonly replayFrameIntervalMs: number;
  readonly replayRetentionSeconds: number;
  readonly targetLostTimeoutSeconds: number;
  readonly targetTrackingEnabled: boolean;
}

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export const loadConfig = (env: NodeJS.ProcessEnv): BlipWatchConfig => ({
  calibrationCaptureDirectory: parseNonEmptyString(
    env.CALIBRATION_CAPTURE_DIRECTORY ?? env.CALIBRATION_CAPTURE_DIR,
    "CALIBRATION_CAPTURE_DIRECTORY",
    DEFAULTS.calibrationCaptureDirectory
  ),
  calibrationCaptureEnabled: parseBoolean(
    env.CALIBRATION_CAPTURE_ENABLED,
    "CALIBRATION_CAPTURE_ENABLED",
    DEFAULTS.calibrationCaptureEnabled
  ),
  calibrationCaptureIntervalMs: parsePositiveInteger(
    env.CALIBRATION_CAPTURE_INTERVAL_MS,
    "CALIBRATION_CAPTURE_INTERVAL_MS",
    DEFAULTS.calibrationCaptureIntervalMs
  ),
  calibrationCapturePacketLimit: parseNonNegativeInteger(
    env.CALIBRATION_CAPTURE_PACKET_LIMIT,
    "CALIBRATION_CAPTURE_PACKET_LIMIT",
    DEFAULTS.calibrationCapturePacketLimit
  ),
  headless: parseBoolean(env.HEADLESS ?? env.BLIPWATCH_HEADLESS, "HEADLESS", DEFAULTS.headless),
  imageSize: parsePositiveInteger(env.IMAGE_SIZE, "IMAGE_SIZE", DEFAULTS.imageSize),
  logLevel: parseLogLevel(env.LOG_LEVEL),
  openBrowser: parseOpenBrowser(env.OPEN_BROWSER ?? env.BLIPWATCH_OPEN_BROWSER, env.HEADLESS ?? env.BLIPWATCH_HEADLESS),
  port: parsePort(env.PORT, "PORT", DEFAULTS.port),
  portFallbackEnabled: parseBoolean(
    env.PORT_FALLBACK_ENABLED ?? env.BLIPWATCH_PORT_FALLBACK_ENABLED,
    "PORT_FALLBACK_ENABLED",
    DEFAULTS.portFallbackEnabled
  ),
  portFallbackMaxAttempts: parsePositiveInteger(
    env.PORT_FALLBACK_MAX_ATTEMPTS ?? env.BLIPWATCH_PORT_FALLBACK_MAX_ATTEMPTS,
    "PORT_FALLBACK_MAX_ATTEMPTS",
    DEFAULTS.portFallbackMaxAttempts
  ),
  radarBrightnessScale: parsePositiveInteger(
    env.RADAR_BRIGHTNESS_SCALE,
    "RADAR_BRIGHTNESS_SCALE",
    DEFAULTS.radarBrightnessScale
  ),
  radarControlEnabled: parseBoolean(env.RADAR_CONTROL_ENABLED, "RADAR_CONTROL_ENABLED", DEFAULTS.radarControlEnabled),
  radarControlFallbackHost: parseIpv4Address(
    env.RADAR_CONTROL_FALLBACK_HOST,
    "RADAR_CONTROL_FALLBACK_HOST",
    DEFAULTS.radarControlFallbackHost
  ),
  radarControlHost: parseRadarControlHost(env.RADAR_CONTROL_HOST),
  radarControlMode: parseRadarControlMode(env.RADAR_CONTROL_MODE),
  radarControlPort: parsePort(env.RADAR_CONTROL_PORT, "RADAR_CONTROL_PORT", DEFAULTS.radarControlPort),
  radarControlStayAliveIntervalMs: parsePositiveInteger(
    env.RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS,
    "RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS",
    DEFAULTS.radarControlStayAliveIntervalMs
  ),
  radarControlWakeHost: parseIpv4Address(
    env.RADAR_CONTROL_WAKE_HOST,
    "RADAR_CONTROL_WAKE_HOST",
    DEFAULTS.radarControlWakeHost
  ),
  radarControlWakePort: parsePort(env.RADAR_CONTROL_WAKE_PORT, "RADAR_CONTROL_WAKE_PORT", DEFAULTS.radarControlWakePort),
  radarDiscoveryEnabled: parseBoolean(env.RADAR_DISCOVERY_ENABLED, "RADAR_DISCOVERY_ENABLED", DEFAULTS.radarDiscoveryEnabled),
  radarDisplayRangeMeters: parseAutoOrPositiveInteger(
    env.RADAR_DISPLAY_RANGE_METERS,
    "RADAR_DISPLAY_RANGE_METERS",
    DEFAULTS.radarDisplayRangeMeters
  ),
  radarInterface: parseNonEmptyString(env.RADAR_INTERFACE, "RADAR_INTERFACE", DEFAULTS.radarInterface),
  radarMulticastGroups: parseMulticastGroups(env.RADAR_MULTICAST_GROUPS),
  radarReportMulticastGroup: parseMulticastGroup(
    env.RADAR_REPORT_MULTICAST_GROUP,
    "RADAR_REPORT_MULTICAST_GROUP",
    DEFAULTS.radarReportMulticastGroup
  ),
  radarReportUdpPort: parsePort(env.RADAR_REPORT_UDP_PORT, "RADAR_REPORT_UDP_PORT", DEFAULTS.radarReportUdpPort),
  radarRenderPalette: parseRadarRenderPalette(env.RADAR_RENDER_PALETTE),
  radarTargetFadeMs: parsePositiveInteger(
    env.RADAR_TARGET_FADE_MS,
    "RADAR_TARGET_FADE_MS",
    DEFAULTS.radarTargetFadeMs
  ),
  radarTargetMaxAgeMs: parsePositiveInteger(
    env.RADAR_TARGET_MAX_AGE_MS,
    "RADAR_TARGET_MAX_AGE_MS",
    DEFAULTS.radarTargetMaxAgeMs
  ),
  radarTargetPersistenceMs: parseNonNegativeInteger(
    env.RADAR_TARGET_PERSISTENCE_MS,
    "RADAR_TARGET_PERSISTENCE_MS",
    DEFAULTS.radarTargetPersistenceMs
  ),
  radarTargetExpansion: parsePositiveInteger(
    env.RADAR_TARGET_EXPANSION,
    "RADAR_TARGET_EXPANSION",
    DEFAULTS.radarTargetExpansion
  ),
  radarUdpPort: parsePort(env.RADAR_UDP_PORT, "RADAR_UDP_PORT", DEFAULTS.radarUdpPort),
  rawRecordingDirectory: parseNonEmptyString(
    env.RAW_RECORDING_DIRECTORY ?? env.RAW_RECORDING_DIR,
    "RAW_RECORDING_DIRECTORY",
    DEFAULTS.rawRecordingDirectory
  ),
  replayFrameIntervalMs: parsePositiveInteger(
    env.REPLAY_FRAME_INTERVAL_MS,
    "REPLAY_FRAME_INTERVAL_MS",
    DEFAULTS.replayFrameIntervalMs
  ),
  replayRetentionSeconds: parsePositiveInteger(
    env.REPLAY_RETENTION_SECONDS,
    "REPLAY_RETENTION_SECONDS",
    DEFAULTS.replayRetentionSeconds
  ),
  targetLostTimeoutSeconds: parsePositiveInteger(
    env.TARGET_LOST_TIMEOUT_SECONDS,
    "TARGET_LOST_TIMEOUT_SECONDS",
    DEFAULTS.targetLostTimeoutSeconds
  ),
  targetTrackingEnabled: parseBoolean(
    env.TARGET_TRACKING_ENABLED,
    "TARGET_TRACKING_ENABLED",
    DEFAULTS.targetTrackingEnabled
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

const parseOpenBrowser = (value: string | undefined, headlessValue: string | undefined): boolean => {
  if (value !== undefined && value !== "") {
    return parseBoolean(value, "OPEN_BROWSER", DEFAULTS.openBrowser);
  }

  const headless = parseBoolean(headlessValue, "HEADLESS", DEFAULTS.headless);
  return headless ? false : DEFAULTS.openBrowser;
};

const parsePositiveInteger = (value: string | undefined, name: string, defaultValue: number): number => {
  const parsed = parseInteger(value, name, defaultValue);
  if (parsed <= 0) {
    throw new ConfigurationError(`${name} must be greater than 0; received ${parsed}`);
  }

  return parsed;
};

const parseAutoOrPositiveInteger = (
  value: string | undefined,
  name: string,
  defaultValue: number | "auto"
): number | "auto" => {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (value === "auto") {
    return value;
  }

  return parsePositiveInteger(value, name, typeof defaultValue === "number" ? defaultValue : 1);
};

const parseNonNegativeInteger = (value: string | undefined, name: string, defaultValue: number): number => {
  const parsed = parseInteger(value, name, defaultValue);
  if (parsed < 0) {
    throw new ConfigurationError(`${name} must be greater than or equal to 0; received ${parsed}`);
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

const parseRadarControlMode = (value: string | undefined): RadarControlMode => {
  if (value === undefined || value === "") {
    return DEFAULTS.radarControlMode;
  }

  if (value === "wake" || value === "transmit") {
    return value;
  }

  throw new ConfigurationError(`RADAR_CONTROL_MODE must be one of: wake, transmit; received "${value}"`);
};

const parseRadarRenderPalette = (value: string | undefined): RadarRenderPalette => {
  if (value === undefined || value === "") {
    return DEFAULTS.radarRenderPalette;
  }

  if (value === "chartplotter" || value === "grayscale" || value === "green") {
    return value;
  }

  throw new ConfigurationError(
    `RADAR_RENDER_PALETTE must be one of: chartplotter, grayscale, green; received "${value}"`
  );
};

const parseRadarControlHost = (value: string | undefined): string => {
  if (value === undefined || value === "") {
    return DEFAULTS.radarControlHost;
  }

  if (value === "auto") {
    return value;
  }

  return parseIpv4Address(value, "RADAR_CONTROL_HOST", DEFAULTS.radarControlFallbackHost);
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

const parseIpv4Address = (value: string | undefined, name: string, defaultValue: string): string => {
  const parsed = parseNonEmptyString(value, name, defaultValue);
  if (isIP(parsed) !== 4) {
    throw new ConfigurationError(`${name} must contain an IPv4 address; received "${parsed}"`);
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
