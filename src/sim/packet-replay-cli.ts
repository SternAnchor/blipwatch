import { loadReplayPackets, replayPackets } from "./packet-replay.js";

interface ReplayConfig {
  readonly filePath: string;
  readonly host: string;
  readonly port: number;
}

const loadReplayConfig = (env: NodeJS.ProcessEnv): ReplayConfig => ({
  filePath: parseRequiredString(env.REPLAY_PACKET_FILE, "REPLAY_PACKET_FILE"),
  host: env.REPLAY_RADAR_HOST ?? "127.0.0.1",
  port: parseInteger(env.REPLAY_RADAR_PORT ?? env.RADAR_UDP_PORT, 6678)
});

const parseRequiredString = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
};

const parseInteger = (value: string | undefined, defaultValue: number): number => {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer replay value, received "${value}"`);
  }

  return parsed;
};

const run = async (): Promise<void> => {
  const config = loadReplayConfig(process.env);
  const packets = await loadReplayPackets(config.filePath);
  console.info(
    JSON.stringify({
      event: "packet_replay_started",
      filePath: config.filePath,
      host: config.host,
      packetCount: packets.length,
      port: config.port
    })
  );

  await replayPackets(packets, {
    host: config.host,
    port: config.port
  });

  console.info(JSON.stringify({ event: "packet_replay_finished", packetCount: packets.length }));
};

try {
  await run();
} catch (error) {
  console.error("packet replay failed", error);
  process.exitCode = 1;
}
