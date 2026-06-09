import { loadPacketSummary } from "./packet-summary.js";

interface PacketSummaryConfig {
  readonly filePath: string;
}

const loadPacketSummaryConfig = (env: NodeJS.ProcessEnv): PacketSummaryConfig => ({
  filePath: parseRequiredString(env.REPLAY_PACKET_FILE ?? env.PACKET_SUMMARY_FILE, "REPLAY_PACKET_FILE")
});

const parseRequiredString = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
};

const run = async (): Promise<void> => {
  const config = loadPacketSummaryConfig(process.env);
  const summary = await loadPacketSummary(config.filePath);
  console.info(JSON.stringify({ event: "packet_summary", filePath: config.filePath, summary }, null, 2));
};

try {
  await run();
} catch (error) {
  console.error("packet summary failed", error);
  process.exitCode = 1;
}
