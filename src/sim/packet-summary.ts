import { classifyRadarPacket, type RadarPacketKind } from "../radar/packet-classifier.js";
import { loadReplayPackets, type ReplayPacket } from "./packet-replay.js";

export interface PacketSummaryBucket {
  readonly count: number;
  readonly key: string;
}

export interface PacketSummary {
  readonly averageEntropyBits: number;
  readonly firstPacketDelayMs: number;
  readonly kindCounts: readonly PacketSummaryBucket[];
  readonly lengthCounts: readonly PacketSummaryBucket[];
  readonly maxLengthBytes: number;
  readonly minLengthBytes: number;
  readonly packetCount: number;
  readonly prefixCounts: readonly PacketSummaryBucket[];
  readonly totalDelayMs: number;
  readonly totalPayloadBytes: number;
}

export const loadPacketSummary = async (filePath: string): Promise<PacketSummary> => {
  const packets = await loadReplayPackets(filePath);
  return summarizeReplayPackets(packets);
};

export const summarizeReplayPackets = (packets: readonly ReplayPacket[]): PacketSummary => {
  const kindCounts = new Map<RadarPacketKind, number>();
  const lengthCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();
  let entropyTotal = 0;
  let maxLengthBytes = 0;
  let minLengthBytes = Number.POSITIVE_INFINITY;
  let totalDelayMs = 0;
  let totalPayloadBytes = 0;

  for (const packet of packets) {
    const payload = packet.payload;
    const classification = classifyRadarPacket(payload);
    const lengthKey = String(payload.byteLength);
    const prefixKey = payload.subarray(0, Math.min(8, payload.byteLength)).toString("hex") || "<empty>";

    increment(kindCounts, classification.kind);
    increment(lengthCounts, lengthKey);
    increment(prefixCounts, prefixKey);

    entropyTotal += calculateEntropyBits(payload);
    maxLengthBytes = Math.max(maxLengthBytes, payload.byteLength);
    minLengthBytes = Math.min(minLengthBytes, payload.byteLength);
    totalDelayMs += packet.delayMs;
    totalPayloadBytes += payload.byteLength;
  }

  return {
    averageEntropyBits: packets.length === 0 ? 0 : round(entropyTotal / packets.length, 4),
    firstPacketDelayMs: packets[0]?.delayMs ?? 0,
    kindCounts: toSortedBuckets(kindCounts),
    lengthCounts: toSortedBuckets(lengthCounts),
    maxLengthBytes,
    minLengthBytes: Number.isFinite(minLengthBytes) ? minLengthBytes : 0,
    packetCount: packets.length,
    prefixCounts: toSortedBuckets(prefixCounts),
    totalDelayMs,
    totalPayloadBytes
  };
};

const calculateEntropyBits = (payload: Buffer): number => {
  if (payload.byteLength === 0) {
    return 0;
  }

  const counts = new Array<number>(256).fill(0);
  for (const value of payload) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts.reduce((entropy, count) => {
    if (count === 0) {
      return entropy;
    }

    const probability = count / payload.byteLength;
    return entropy - probability * Math.log2(probability);
  }, 0);
};

const increment = <T>(counts: Map<T, number>, key: T): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const round = (value: number, places: number): number => {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
};

const toSortedBuckets = <T>(counts: Map<T, number>): PacketSummaryBucket[] =>
  Array.from(counts.entries())
    .map(([key, count]) => ({ count, key: String(key) }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "en", { numeric: true }));
