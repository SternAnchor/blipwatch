import { createSocket, type Socket } from "node:dgram";
import { readFile } from "node:fs/promises";

export interface ReplayPacket {
  readonly delayMs: number;
  readonly payload: Buffer;
}

export interface ReplayTarget {
  readonly host: string;
  readonly port: number;
}

interface JsonReplayLine {
  readonly delayMs?: unknown;
  readonly payloadHex?: unknown;
}

export const loadReplayPackets = async (filePath: string): Promise<ReplayPacket[]> => {
  const content = await readFile(filePath, "utf8");
  return parseReplayPackets(content);
};

export const parseReplayPackets = (content: string): ReplayPacket[] =>
  content.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return [];
    }

    return [parseReplayLine(trimmed, index + 1)];
  });

export const replayPackets = async (
  packets: readonly ReplayPacket[],
  target: ReplayTarget,
  socket: Socket = createSocket("udp4")
): Promise<void> => {
  try {
    for (const [index, packet] of packets.entries()) {
      if (index > 0 && packet.delayMs > 0) {
        await sleep(packet.delayMs);
      }

      await sendPacket(socket, target, packet.payload);
    }
  } finally {
    socket.close();
  }
};

const parseReplayLine = (line: string, lineNumber: number): ReplayPacket => {
  if (line.startsWith("{")) {
    return parseJsonReplayLine(line, lineNumber);
  }

  return {
    delayMs: 0,
    payload: parseHexPayload(line, lineNumber)
  };
};

const parseJsonReplayLine = (line: string, lineNumber: number): ReplayPacket => {
  let parsed: JsonReplayLine;
  try {
    parsed = JSON.parse(line) as JsonReplayLine;
  } catch (error) {
    throw new Error(`Replay line ${lineNumber} is not valid JSON`, { cause: error });
  }

  if (typeof parsed.payloadHex !== "string") {
    throw new Error(`Replay line ${lineNumber} must include a string payloadHex field`);
  }

  return {
    delayMs: parseDelayMs(parsed.delayMs, lineNumber),
    payload: parseHexPayload(parsed.payloadHex, lineNumber)
  };
};

const parseDelayMs = (value: unknown, lineNumber: number): number => {
  if (value === undefined) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Replay line ${lineNumber} delayMs must be a non-negative integer`);
  }

  return value;
};

const parseHexPayload = (value: string, lineNumber: number): Buffer => {
  const normalized = value.replaceAll(/\s/g, "");
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[\da-fA-F]+$/.test(normalized)) {
    throw new Error(`Replay line ${lineNumber} payload must be even-length hexadecimal`);
  }

  return Buffer.from(normalized, "hex");
};

const sendPacket = async (socket: Socket, target: ReplayTarget, packet: Buffer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    socket.send(packet, target.port, target.host, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
