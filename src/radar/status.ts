export type RadarOperatingState = "standby" | "transmit" | "unknown" | "waking-up";
export type RadarOperatingStateSource = "inferred" | "report" | "traffic";

export interface RadarReceiverStatus {
  readonly boundInterface: string | null;
  readonly lastPacketAt: string | null;
  readonly lastSourceAddress: string | null;
  readonly multicastInterface: string | null;
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

export interface RadarControlStatus {
  readonly commandTarget: string;
  readonly commandTargetSource: string;
  readonly commandsSent: number;
  readonly desiredState: "standby" | "transmit";
  readonly enabled: boolean;
  readonly lastCommandAt: string | null;
  readonly lastCommandName: string | null;
  readonly lastError: string | null;
  readonly lastRequestAt: string | null;
  readonly mode: string;
  readonly observedState: RadarOperatingState | null;
  readonly observedStateAt: string | null;
  readonly observedStateSource: RadarOperatingStateSource | null;
  readonly running: boolean;
  readonly stayAliveIntervalMs: number;
  readonly wakeTarget: string;
}

export interface RadarDiscoveryRadar {
  readonly command: string;
  readonly commandEndpoint: string | null;
  readonly dataEndpoint: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly model: string | null;
  readonly name: string | null;
  readonly reportEndpoint: string | null;
  readonly reportType: string;
  readonly serial: string | null;
  readonly sourceAddress: string;
  readonly sourcePort: number;
  readonly status: string | null;
  readonly statusName: string | null;
}

export interface RadarDiscoveryStatus {
  readonly boundInterface: string | null;
  readonly enabled: boolean;
  readonly lastReportAt: string | null;
  readonly lastReportSource: string | null;
  readonly multicastInterface: string | null;
  readonly multicastGroup: string;
  readonly radar: RadarDiscoveryRadar | null;
  readonly reportsReceived: number;
  readonly running: boolean;
  readonly udpPort: number | null;
}

export interface RadarRendererStatus {
  readonly imageAvailable: boolean;
  readonly imageSize: number;
  readonly lastRenderedImageAt: string | null;
  readonly lastSpokeAt: string | null;
  readonly renderState: "empty" | "ready";
  readonly spokeCount: number;
}

export type RadarStatusPhase =
  | "receiving-and-rendering"
  | "receiving-but-not-decoding"
  | "decoded-but-not-rendered"
  | "discovery-only"
  | "waiting-for-udp"
  | "listener-stopped";

export interface RadarStatusDiagnostics {
  readonly phase: RadarStatusPhase;
  readonly summary: string;
  readonly nextActions: readonly string[];
}

export interface RadarStreamingStatus {
  readonly clientsConnected: number;
  readonly lastClientConnectedAt: string | null;
  readonly lastMessageAt: string | null;
  readonly messagesSent: number;
  readonly totalClientsConnected: number;
  readonly updatesDropped: number;
}

export interface RadarStatus {
  readonly control: RadarControlStatus;
  readonly decoder: RadarDecoderStatus;
  readonly diagnostics: RadarStatusDiagnostics;
  readonly discovery: RadarDiscoveryStatus;
  readonly receiver: RadarReceiverStatus;
  readonly renderer: RadarRendererStatus;
  readonly streaming: RadarStreamingStatus;
}
