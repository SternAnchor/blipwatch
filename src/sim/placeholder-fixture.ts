export interface PlaceholderSpokeFixtureOptions {
  readonly angleDegrees?: number;
  readonly intensities?: readonly number[];
  readonly rangeMeters?: number;
}

const MAGIC = "BWS1";
const SPOKE_TYPE = 1;
const VERSION = 1;

export const createPlaceholderSpokePacket = ({
  angleDegrees = 123.4,
  intensities = [0, 15, 128, 255],
  rangeMeters = 2000
}: PlaceholderSpokeFixtureOptions = {}): Buffer => {
  const sampleCount = intensities.length;
  const packet = Buffer.alloc(12 + sampleCount);
  packet.write(MAGIC, 0, "ascii");
  packet.writeUInt8(SPOKE_TYPE, 4);
  packet.writeUInt8(VERSION, 5);
  packet.writeUInt16BE(Math.round(angleDegrees * 10), 6);
  packet.writeUInt16BE(rangeMeters, 8);
  packet.writeUInt16BE(sampleCount, 10);

  for (const [index, intensity] of intensities.entries()) {
    packet.writeUInt8(clampByte(intensity), 12 + index);
  }

  return packet;
};

const clampByte = (value: number): number => Math.min(Math.max(Math.round(value), 0), 255);
