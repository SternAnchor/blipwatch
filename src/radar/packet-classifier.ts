export type RadarPacketKind = "empty" | "halo-candidate" | "placeholder-spoke" | "unknown";

export interface RadarPacketClassification {
  readonly kind: RadarPacketKind;
  readonly reason: string;
}

const PLACEHOLDER_MAGIC = "BWS1";
const HALO_ASCII_PREFIX = "HALO";
const HALO_CANDIDATE_MIN_BYTES = 24;

export const classifyRadarPacket = (data: Buffer): RadarPacketClassification => {
  if (data.byteLength === 0) {
    return { kind: "empty", reason: "packet is empty" };
  }

  const asciiPrefix = data.subarray(0, Math.min(4, data.byteLength)).toString("ascii");
  if (asciiPrefix === PLACEHOLDER_MAGIC) {
    return { kind: "placeholder-spoke", reason: "matches BlipWatch simulator placeholder magic" };
  }

  if (asciiPrefix === HALO_ASCII_PREFIX) {
    return { kind: "halo-candidate", reason: "starts with HALO ASCII marker" };
  }

  if (data.byteLength >= HALO_CANDIDATE_MIN_BYTES) {
    return { kind: "halo-candidate", reason: `payload is ${data.byteLength} bytes and may contain HALO radar data` };
  }

  return { kind: "unknown", reason: `payload is ${data.byteLength} bytes and does not match known radar markers` };
};
