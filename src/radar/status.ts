import type { RadarRenderPalette } from "../config/config.js";
import type { RawRecordingReplayStatus } from "../recording/raw-recording-replay.js";
import type { RawRecordingStoreStatus } from "../recording/raw-recording-store.js";
import type { ReplayMetadata } from "../replay/replay-buffer.js";
import type { RadarTargetManagerStatus } from "../targets/target-manager.js";

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
  readonly capabilities: RadarControlCapabilities;
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
  readonly tuning: RadarControlTuningStatus;
  readonly wakeTarget: string;
}

export interface RadarControlCapability {
  readonly reason: string | null;
  readonly supported: boolean;
}

export interface RadarControlCapabilities {
  readonly gain: RadarControlCapability;
  readonly rainClutter: RadarControlCapability;
  readonly range: RadarControlCapability;
  readonly seaClutter: RadarControlCapability;
}

export type RadarControlTuningMode = "auto" | "manual";

export interface RadarControlTuningSettingStatus {
  readonly lastError: string | null;
  readonly lastRequestAt: string | null;
  readonly mode: RadarControlTuningMode;
  readonly value: number | null;
}

export interface RadarControlTuningRangeStatus {
  readonly lastError: string | null;
  readonly lastRequestAt: string | null;
  readonly rangeMeters: number | null;
}

export interface RadarControlTuningStatus {
  readonly gain: RadarControlTuningSettingStatus;
  readonly rainClutter: RadarControlTuningSettingStatus;
  readonly range: RadarControlTuningRangeStatus;
  readonly seaClutter: RadarControlTuningSettingStatus;
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
  readonly activePixelCount: number;
  readonly imageAvailable: boolean;
  readonly imageSize: number;
  readonly lastRenderedImageAt: string | null;
  readonly lastSpokeAt: string | null;
  readonly maxIntensity: number;
  readonly radarBrightnessScale: number;
  readonly radarRenderPalette: RadarRenderPalette;
  readonly renderState: "empty" | "ready";
  readonly spokeCount: number;
  readonly targetExpansion: number;
  readonly targetMaxAgeMs: number;
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

export interface ProcessStatus {
  readonly memory: {
    readonly arrayBuffers: number;
    readonly external: number;
    readonly heapTotal: number;
    readonly heapUsed: number;
    readonly rss: number;
  };
  readonly uptimeSeconds: number;
}

export interface RadarStatus {
  readonly control: RadarControlStatus;
  readonly decoder: RadarDecoderStatus;
  readonly diagnostics: RadarStatusDiagnostics;
  readonly discovery: RadarDiscoveryStatus;
  readonly process: ProcessStatus;
  readonly receiver: RadarReceiverStatus;
  readonly recording: RawRecordingStoreStatus;
  readonly renderer: RadarRendererStatus;
  readonly replay: ReplayMetadata;
  readonly rawReplay: RawRecordingReplayStatus;
  readonly streaming: RadarStreamingStatus;
  readonly targets: RadarTargetManagerStatus;
}
