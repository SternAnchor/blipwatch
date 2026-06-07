import type { Logger } from "../logging/logger.js";
import { decodeNavicoHaloFrame } from "./halo-decoder.js";
import { classifyRadarPacket } from "./packet-classifier.js";
import type { RadarPacket } from "./receiver.js";

export interface RadarDecoder {
  readonly name: string;
  decode(packet: RadarPacket | Buffer): RadarDecodeResult;
}

interface RadarDecoderOptions {
  readonly logger: Logger;
}

export interface RadarSpoke {
  readonly angleDegrees: number;
  readonly intensities: Uint8Array;
  readonly maxIntensity: number;
  readonly rangeMeters: number;
  readonly receivedAt?: Date;
  readonly sampleCount: number;
  readonly type: "spoke";
}

export type RadarDecodeErrorCode = "empty-packet" | "incomplete-packet" | "unsupported-packet" | "malformed-packet";

export interface RadarDecodeError {
  readonly code: RadarDecodeErrorCode;
  readonly message: string;
}

export interface RadarDecodeSuccess {
  readonly ok: true;
  readonly spoke: RadarSpoke;
}

export interface RadarDecodeFailure {
  readonly error: RadarDecodeError;
  readonly ok: false;
}

export type RadarDecodeResult = RadarDecodeFailure | RadarDecodeSuccess;

const PLACEHOLDER_MAGIC = "BWS1";
const PLACEHOLDER_SPOKE_TYPE = 1;
const PLACEHOLDER_VERSION = 1;
const PLACEHOLDER_HEADER_LENGTH = 12;

export const createRadarDecoder = ({ logger }: RadarDecoderOptions): RadarDecoder => {
  logger.debug("radar decoder initialized");
  return {
    decode(packet: RadarPacket | Buffer): RadarDecodeResult {
      const data = Buffer.isBuffer(packet) ? packet : packet.data;
      const receivedAt = Buffer.isBuffer(packet) ? undefined : packet.receivedAt;
      const classification = classifyRadarPacket(data);
      const result = decodePacket(data, receivedAt);

      if (result.ok) {
        logger.debug(
          `radar packet decoded type=spoke kind=${classification.kind} angle=${result.spoke.angleDegrees} rangeMeters=${result.spoke.rangeMeters} samples=${result.spoke.sampleCount} maxIntensity=${result.spoke.maxIntensity}`
        );
      } else {
        logger.debug(
          `radar packet decode skipped kind=${classification.kind} code=${result.error.code} reason=${classification.reason} message=${result.error.message}`
        );
      }

      return result;
    },
    name: "halo-scaffold-decoder"
  };
};

const decodePacket = (data: Buffer, receivedAt: Date | undefined): RadarDecodeResult => {
  if (data.byteLength === 0) {
    return failure("empty-packet", "packet is empty");
  }

  const classification = classifyRadarPacket(data);
  if (classification.kind === "navico-halo-frame") {
    return decodeNavicoHaloFrame(data, receivedAt);
  }

  if (data.byteLength < PLACEHOLDER_HEADER_LENGTH) {
    return failure(
      "incomplete-packet",
      `packet is too short; expected at least ${PLACEHOLDER_HEADER_LENGTH} bytes, received ${data.byteLength}`
    );
  }

  const magic = data.subarray(0, 4).toString("ascii");
  if (magic !== PLACEHOLDER_MAGIC) {
    if (classification.kind === "halo-candidate") {
      return failure("unsupported-packet", `HALO packet candidate decoding is not implemented: ${classification.reason}`);
    }

    return failure("unsupported-packet", `unsupported packet magic "${magic}"`);
  }

  const packetType = data.readUInt8(4);
  const version = data.readUInt8(5);
  if (packetType !== PLACEHOLDER_SPOKE_TYPE || version !== PLACEHOLDER_VERSION) {
    return failure("unsupported-packet", `unsupported packet type=${packetType} version=${version}`);
  }

  const angleTenths = data.readUInt16BE(6);
  const rangeMeters = data.readUInt16BE(8);
  const sampleCount = data.readUInt16BE(10);
  const expectedLength = PLACEHOLDER_HEADER_LENGTH + sampleCount;

  if (sampleCount === 0) {
    return failure("malformed-packet", "spoke packet must contain at least one intensity sample");
  }

  if (angleTenths >= 3600) {
    return failure("malformed-packet", `angle must be less than 360.0 degrees; received ${angleTenths / 10}`);
  }

  if (rangeMeters === 0) {
    return failure("malformed-packet", "rangeMeters must be greater than 0");
  }

  if (data.byteLength < expectedLength) {
    return failure(
      "incomplete-packet",
      `spoke packet declared ${sampleCount} samples but only ${Math.max(data.byteLength - PLACEHOLDER_HEADER_LENGTH, 0)} were present`
    );
  }

  const intensities = Uint8Array.from(data.subarray(PLACEHOLDER_HEADER_LENGTH, expectedLength));

  return {
    ok: true,
    spoke: {
      angleDegrees: angleTenths / 10,
      intensities,
      maxIntensity: Math.max(...intensities),
      rangeMeters,
      receivedAt,
      sampleCount,
      type: "spoke"
    }
  };
};

const failure = (code: RadarDecodeErrorCode, message: string): RadarDecodeFailure => ({
  error: { code, message },
  ok: false
});
