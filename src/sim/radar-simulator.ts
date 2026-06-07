import { createSocket, type Socket } from "node:dgram";

import { createPlaceholderSpokePacket } from "./placeholder-fixture.js";

interface SimulatorConfig {
  readonly count: number;
  readonly host: string;
  readonly intervalMs: number;
  readonly port: number;
}

const loadSimulatorConfig = (env: NodeJS.ProcessEnv): SimulatorConfig => ({
  count: parseInteger(env.SIM_PACKET_COUNT, 1),
  host: env.SIM_RADAR_HOST ?? "127.0.0.1",
  intervalMs: parseInteger(env.SIM_PACKET_INTERVAL_MS, 1000),
  port: parseInteger(env.SIM_RADAR_PORT ?? env.RADAR_UDP_PORT, 6678)
});

const parseInteger = (value: string | undefined, defaultValue: number): number => {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer simulator value, received "${value}"`);
  }

  return parsed;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const sendPacket = async (socket: Socket, host: string, port: number, packet: Buffer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    socket.send(packet, port, host, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const run = async (): Promise<void> => {
  const config = loadSimulatorConfig(process.env);
  console.info(
    JSON.stringify({
      count: config.count,
      event: "simulator_started",
      host: config.host,
      intervalMs: config.intervalMs,
      port: config.port
    })
  );

  const socket = createSocket("udp4");
  try {
    for (let index = 0; index < config.count; index += 1) {
      const packet = createPlaceholderSpokePacket({
        angleDegrees: (index * 10) % 360,
        intensities: [0, 64, 128, 255],
        rangeMeters: 2000
      });
      await sendPacket(socket, config.host, config.port, packet);
      console.info(JSON.stringify({ bytes: packet.byteLength, event: "simulator_packet_sent", index }));

      if (index < config.count - 1) {
        await sleep(config.intervalMs);
      }
    }
  } finally {
    socket.close();
  }

  console.info(JSON.stringify({ event: "simulator_finished" }));
};

try {
  await run();
} catch (error) {
  console.error("radar simulator failed", error);
  process.exitCode = 1;
}
