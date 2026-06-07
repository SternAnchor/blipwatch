export interface RadarReceiverStatus {
  readonly boundInterface: string | null;
  readonly lastPacketAt: string | null;
  readonly lastSourceAddress: string | null;
  readonly multicastGroups: readonly string[];
  readonly packetsReceived: number;
  readonly running: boolean;
  readonly udpPort: number | null;
}

export interface RadarDecoderStatus {
  readonly lastDecodedSpokeAt: string | null;
  readonly packetsDecoded: number;
  readonly packetsRejected: number;
}

export interface RadarRendererStatus {
  readonly imageAvailable: boolean;
  readonly imageSize: number;
  readonly lastRenderedImageAt: string | null;
  readonly lastSpokeAt: string | null;
  readonly renderState: "empty" | "ready";
  readonly spokeCount: number;
}

export interface RadarStatus {
  readonly decoder: RadarDecoderStatus;
  readonly receiver: RadarReceiverStatus;
  readonly renderer: RadarRendererStatus;
}
