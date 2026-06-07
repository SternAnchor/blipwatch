export type LogLevel = "debug" | "info";

export interface BlipWatchConfig {
  readonly imageSize: number;
  readonly logLevel: LogLevel;
  readonly port: number;
  readonly radarInterface: string;
  readonly radarUdpPort: number;
  readonly replayFrameIntervalMs: number;
  readonly replayRetentionSeconds: number;
}

export const loadConfig = (env: NodeJS.ProcessEnv): BlipWatchConfig => ({
  imageSize: Number.parseInt(env.IMAGE_SIZE ?? "1024", 10),
  logLevel: env.LOG_LEVEL === "debug" ? "debug" : "info",
  port: Number.parseInt(env.PORT ?? "8080", 10),
  radarInterface: env.RADAR_INTERFACE ?? "0.0.0.0",
  radarUdpPort: Number.parseInt(env.RADAR_UDP_PORT ?? "6678", 10),
  replayFrameIntervalMs: Number.parseInt(env.REPLAY_FRAME_INTERVAL_MS ?? "1000", 10),
  replayRetentionSeconds: Number.parseInt(env.REPLAY_RETENTION_SECONDS ?? "300", 10)
});
