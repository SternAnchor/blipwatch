export interface NavicoHaloFrameOptions {
  readonly angleRaw?: number;
  readonly firstPackedReturns?: readonly number[];
  readonly largeRange?: number;
  readonly lineCount?: number;
  readonly smallRange?: number;
  readonly status?: number;
}

export const createNavicoHaloFramePacket = ({
  angleRaw = 1024,
  firstPackedReturns = [0xf0, 0xe1],
  largeRange = 0x0020,
  lineCount = 1,
  smallRange = 32000,
  status = 0x02
}: NavicoHaloFrameOptions = {}): Buffer => {
  const lineBytes = 536;
  const frame = Buffer.alloc(8 + lineBytes * lineCount);
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const lineOffset = 8 + lineIndex * lineBytes;
    frame.writeUInt8(0x18, lineOffset);
    frame.writeUInt8(status, lineOffset + 1);
    frame.writeUInt16LE(0, lineOffset + 2);
    frame.writeUInt16LE(largeRange, lineOffset + 6);
    frame.writeUInt16LE((angleRaw + lineIndex) % 4096, lineOffset + 8);
    frame.writeUInt16LE(0xffff, lineOffset + 10);
    frame.writeUInt16LE(smallRange, lineOffset + 12);

    for (const [index, value] of firstPackedReturns.entries()) {
      frame[lineOffset + 24 + index] = value;
    }
  }

  return frame;
};
