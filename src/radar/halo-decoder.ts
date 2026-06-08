import type { RadarDecodeFailure, RadarDecodeResult, RadarSpoke } from "./decoder.js";

const FRAME_HEADER_BYTES = 8;
const LINE_HEADER_BYTES = 24;
const PACKED_INTENSITY_BYTES = 512;
const LINE_BYTES = LINE_HEADER_BYTES + PACKED_INTENSITY_BYTES;
const RAW_BEARING_UNITS = 4096;
const EXPECTED_HEADER_LENGTH = 0x18;
const VALID_STATUS_VALUES = new Set([0x02, 0x12]);

export const isNavicoHaloFrameCandidate = (data: Buffer): boolean =>
  data.byteLength >= FRAME_HEADER_BYTES + LINE_BYTES && (data.byteLength - FRAME_HEADER_BYTES) % LINE_BYTES === 0;

export const decodeNavicoHaloFrame = (data: Buffer, receivedAt: Date | undefined): RadarDecodeResult => {
  if (!isNavicoHaloFrameCandidate(data)) {
    return failure("unsupported-packet", "packet does not match the expected Navico/HALO frame sizing");
  }

  const lineCount = (data.byteLength - FRAME_HEADER_BYTES) / LINE_BYTES;
  const spokes: RadarSpoke[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const lineOffset = FRAME_HEADER_BYTES + index * LINE_BYTES;
    const decoded = decodeNavicoHaloLine(data, lineOffset, receivedAt);
    if (decoded.ok) {
      spokes.push(decoded.spoke);
    }
  }

  if (spokes.length > 0) {
    return {
      ok: true,
      spoke: spokes[0] as RadarSpoke,
      spokes
    };
  }

  return failure("malformed-packet", "Navico/HALO frame did not contain a valid scan line");
};

const decodeNavicoHaloLine = (data: Buffer, lineOffset: number, receivedAt: Date | undefined): RadarDecodeResult => {
  const headerLength = data.readUInt8(lineOffset);
  if (headerLength !== EXPECTED_HEADER_LENGTH) {
    return failure("malformed-packet", `Navico/HALO line header length must be 24; received ${headerLength}`);
  }

  const status = data.readUInt8(lineOffset + 1);
  if (!VALID_STATUS_VALUES.has(status)) {
    return failure("malformed-packet", `Navico/HALO line status is not recognized; received 0x${status.toString(16)}`);
  }

  const largeRange = data.readUInt16LE(lineOffset + 6);
  const angleRaw = data.readUInt16LE(lineOffset + 8);
  const smallRange = data.readUInt16LE(lineOffset + 12);
  const rangeMeters = decodeHaloRangeMeters(largeRange, smallRange);
  if (rangeMeters <= 0) {
    return failure("malformed-packet", "Navico/HALO line range is invalid or unavailable");
  }

  const spoke = {
    angleDegrees: rawBearingToDegrees(angleRaw),
    intensities: unpackFourBitIntensities(data.subarray(lineOffset + LINE_HEADER_BYTES, lineOffset + LINE_BYTES)),
    maxIntensity: 255,
    rangeMeters,
    receivedAt,
    sampleCount: PACKED_INTENSITY_BYTES * 2,
    type: "spoke"
  } satisfies RadarSpoke;

  return {
    ok: true,
    spoke,
    spokes: [spoke]
  };
};

const decodeHaloRangeMeters = (largeRange: number, smallRange: number): number => {
  if (largeRange === 0x80) {
    return smallRange === 0xffff ? 0 : smallRange / 4;
  }

  return (largeRange * smallRange) / 512;
};

const rawBearingToDegrees = (angleRaw: number): number => ((angleRaw % RAW_BEARING_UNITS) * 360) / RAW_BEARING_UNITS;

const unpackFourBitIntensities = (packed: Buffer): Uint8Array => {
  const intensities = new Uint8Array(packed.byteLength * 2);
  for (const [index, value] of packed.entries()) {
    intensities[index * 2] = nibbleToIntensity(value & 0x0f);
    intensities[index * 2 + 1] = nibbleToIntensity((value & 0xf0) >> 4);
  }

  return intensities;
};

const nibbleToIntensity = (value: number): number => Math.round((value / 15) * 255);

const failure = (code: RadarDecodeFailure["error"]["code"], message: string): RadarDecodeFailure => ({
  error: { code, message },
  ok: false
});
