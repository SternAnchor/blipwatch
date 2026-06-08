import { createCalibrationCapture } from "./calibration/calibration-capture.js";
import { createHttpApi } from "./api/http-api.js";
import { ConfigurationError, loadConfig } from "./config/config.js";
import { createLogger, type Logger } from "./logging/logger.js";
import { createRadarControl, type RadarControlObservedState } from "./radar/control.js";
import { createRadarDecoder } from "./radar/decoder.js";
import { createRadarDiscovery } from "./radar/discovery.js";
import { resolveRadarInterface } from "./radar/network-interface.js";
import { createRadarImageRenderer } from "./radar/renderer.js";
import { createRadarReceiver, type RadarPacket } from "./radar/receiver.js";
import type { RadarOperatingState, RadarStatus, RadarStatusDiagnostics } from "./radar/status.js";
import { createReplayBuffer } from "./replay/replay-buffer.js";

export interface BlipWatchServer {
  readonly logger: Logger;
  addresses(): BlipWatchServerAddresses;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface BlipWatchServerAddresses {
  readonly httpPort: number | undefined;
  readonly radarPort: number | undefined;
}

export const createBlipWatchServer = (env: NodeJS.ProcessEnv = process.env): BlipWatchServer => {
  const loadedConfig = loadConfig(env);
  const logger = createLogger({ level: loadedConfig.logLevel });
  const resolvedInterface = resolveRadarInterface(loadedConfig.radarInterface);
  const config = {
    ...loadedConfig,
    radarInterface: resolvedInterface.address
  };
  if (loadedConfig.radarInterface === "auto") {
    logger.info(`auto-selected radar interface ${resolvedInterface.name} (${resolvedInterface.address})`);
  }

  const receiver = createRadarReceiver({ config, logger });
  const control = createRadarControl({
    commandTargetProvider: () => {
      const endpoint = discovery.getStatus().radar?.commandEndpoint;
      if (!endpoint) {
        return undefined;
      }

      const [host, port] = endpoint.split(":");
      if (!host || !port) {
        return undefined;
      }

      return {
        host,
        port: Number.parseInt(port, 10),
        source: "discovered"
      };
    },
    config,
    logger,
    observedStateProvider: () => getObservedRadarOperatingState(discovery.getStatus(), receiver.getStatus())
  });
  const decoder = createRadarDecoder({ logger });
  const discovery = createRadarDiscovery({ config, logger });
  const renderer = createRadarImageRenderer({ config, logger });
  const replayBuffer = createReplayBuffer({ config, logger });
  const calibrationPackets: CalibrationPacketSnapshot[] = [];
  let capturedFirstDecodedPacket = false;
  let lastReplayCaptureAt: Date | undefined;
  let packetsDecoded = 0;
  let packetsRejected = 0;
  let lastDecodedSpokeAt: Date | undefined;
  const getRadarStatus = (): RadarStatus => {
    const rendererMetadata = renderer.getLatestMetadata();
    const decoderStatus = {
      lastDecodedSpokeAt: lastDecodedSpokeAt?.toISOString() ?? null,
      packetsDecoded,
      packetsRejected
    };
    const discoveryStatus = discovery.getStatus();
    const receiverStatus = receiver.getStatus();
    const rendererStatus = {
      imageAvailable: rendererMetadata.renderState === "ready",
      imageSize: rendererMetadata.imageSize,
      lastRenderedImageAt: rendererMetadata.lastFrameAt,
      lastSpokeAt: rendererMetadata.lastSpokeAt,
      renderState: rendererMetadata.renderState,
      spokeCount: rendererMetadata.spokeCount
    } as const;

    return {
      control: control.getStatus(),
      decoder: decoderStatus,
      diagnostics: getRadarStatusDiagnostics({
        decoder: decoderStatus,
        discovery: discoveryStatus,
        receiver: receiverStatus,
        renderer: rendererStatus
      }),
      discovery: discoveryStatus,
      receiver: receiverStatus,
      renderer: rendererStatus,
      streaming: httpApi.getStreamingStats()
    };
  };
  const calibrationCapture = createCalibrationCapture({
    config,
    logger,
    packetSnapshot: () => calibrationPackets,
    radarStatus: getRadarStatus,
    renderer,
    replayBuffer
  });
  const httpApi = createHttpApi({
    calibrationCaptureStatus: () => calibrationCapture.getStatus(),
    config,
    logger,
    radarControl: control,
    radarStatus: getRadarStatus,
    renderer,
    replayBuffer
  });

  return {
    addresses(): BlipWatchServerAddresses {
      return {
        httpPort: httpApi.address()?.port,
        radarPort: receiver.address()?.port
      };
    },
    logger,
    async start(): Promise<void> {
      logger.debug(`loaded config: ${JSON.stringify(redactConfig(config))}`);
      logger.info(`starting BlipWatch on port ${config.port}`);
      await httpApi.start();
      await discovery.start();
      await control.start();
      await calibrationCapture.start();
      receiver.onPacket((packet) => {
        captureCalibrationPacket(calibrationPackets, config.calibrationCapturePacketLimit, packet);
        const result = decoder.decode(packet);
        if (result.ok) {
          packetsDecoded += result.spokes.length;
          for (const spoke of result.spokes) {
            lastDecodedSpokeAt = spoke.receivedAt;
            renderer.applySpoke(spoke);
            const renderedAt = new Date();
            if (shouldCaptureReplayFrame(renderedAt, lastReplayCaptureAt, config.replayFrameIntervalMs)) {
              const replayFrame = replayBuffer.captureFrame({
                capturedAt: renderedAt,
                metadata: renderer.getLatestMetadata(),
                png: renderer.getLatestPng()
              });
              if (replayFrame) {
                httpApi.publishRadarUpdate({
                  reason: "frame",
                  replayFrameAt: replayFrame.capturedAt.toISOString()
                });
              }
              lastReplayCaptureAt = replayFrame?.capturedAt ?? lastReplayCaptureAt;
            }
          }
          if (!capturedFirstDecodedPacket) {
            capturedFirstDecodedPacket = true;
            void calibrationCapture.captureNow().catch((error) => {
              logger.error("first decoded packet calibration capture failed", error);
            });
          }
          return;
        }

        packetsRejected += 1;
      });
      await receiver.start();
      logger.debug(`decoder ready: ${decoder.name}`);
      logger.debug(`renderer ready: ${renderer.imageSize}px`);
      logger.debug(`replay buffer ready: ${replayBuffer.retentionSeconds}s interval=${replayBuffer.frameIntervalMs}ms`);
    },
    async stop(): Promise<void> {
      calibrationCapture.stop();
      await receiver.stop();
      await control.stop();
      await discovery.stop();
      await httpApi.stop();
      logger.info("BlipWatch stopped");
    }
  };
};

const RADAR_TRAFFIC_ACTIVE_WINDOW_MS = 3_000;

const shouldCaptureReplayFrame = (
  capturedAt: Date,
  lastCapturedAt: Date | undefined,
  frameIntervalMs: number
): boolean => !lastCapturedAt || capturedAt.getTime() - lastCapturedAt.getTime() >= frameIntervalMs;

const getObservedRadarOperatingState = (
  discovery: RadarStatus["discovery"],
  receiver: RadarStatus["receiver"]
): RadarControlObservedState => {
  const reportState = normalizeRadarOperatingState(discovery.radar?.statusName);
  if (reportState) {
    return {
      observedAt: discovery.radar?.lastSeenAt ?? discovery.lastReportAt,
      source: "report",
      state: reportState
    };
  }

  if (receiver.lastPacketAt && Date.now() - new Date(receiver.lastPacketAt).getTime() <= RADAR_TRAFFIC_ACTIVE_WINDOW_MS) {
    return {
      observedAt: receiver.lastPacketAt,
      source: "traffic",
      state: "transmit"
    };
  }

  if (discovery.radar) {
    return {
      observedAt: discovery.radar.lastSeenAt,
      source: "inferred",
      state: "standby"
    };
  }

  return {
    observedAt: null,
    source: null,
    state: null
  };
};

const normalizeRadarOperatingState = (statusName: string | null | undefined): RadarOperatingState | null => {
  if (statusName === "standby" || statusName === "transmit" || statusName === "waking-up") {
    return statusName;
  }

  if (statusName === "unknown") {
    return "unknown";
  }

  return null;
};

export { ConfigurationError };

interface CalibrationPacketSnapshot {
  readonly delayMs: number;
  readonly payloadHex: string;
  readonly receivedAt: string;
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly size: number;
}

const captureCalibrationPacket = (
  packets: CalibrationPacketSnapshot[],
  limit: number,
  packet: RadarPacket
): void => {
  if (limit <= 0) {
    return;
  }

  const previous = packets.at(-1);
  const receivedAt = packet.receivedAt.toISOString();
  packets.push({
    delayMs: previous ? Math.max(0, packet.receivedAt.getTime() - new Date(previous.receivedAt).getTime()) : 0,
    payloadHex: packet.data.toString("hex"),
    receivedAt,
    remoteAddress: packet.remote.address,
    remotePort: packet.remote.port,
    size: packet.data.byteLength
  });

  if (packets.length > limit) {
    packets.splice(0, packets.length - limit);
  }
};

const redactConfig = (config: ReturnType<typeof loadConfig>): Record<string, number | string> => ({
  imageSize: config.imageSize,
  calibrationCaptureDirectory: config.calibrationCaptureDirectory,
  calibrationCaptureEnabled: String(config.calibrationCaptureEnabled),
  calibrationCaptureIntervalMs: config.calibrationCaptureIntervalMs,
  calibrationCapturePacketLimit: config.calibrationCapturePacketLimit,
  logLevel: config.logLevel,
  port: config.port,
  radarControlEnabled: String(config.radarControlEnabled),
  radarControlFallbackHost: config.radarControlFallbackHost,
  radarControlHost: config.radarControlHost,
  radarControlMode: config.radarControlMode,
  radarControlPort: config.radarControlPort,
  radarControlStayAliveIntervalMs: config.radarControlStayAliveIntervalMs,
  radarControlWakeHost: config.radarControlWakeHost,
  radarControlWakePort: config.radarControlWakePort,
  radarDiscoveryEnabled: String(config.radarDiscoveryEnabled),
  radarBrightnessScale: config.radarBrightnessScale,
  radarDisplayRangeMeters: String(config.radarDisplayRangeMeters),
  radarInterface: config.radarInterface,
  radarMulticastGroups: config.radarMulticastGroups.join(","),
  radarRenderPalette: config.radarRenderPalette,
  radarReportMulticastGroup: config.radarReportMulticastGroup,
  radarReportUdpPort: config.radarReportUdpPort,
  radarTargetExpansion: config.radarTargetExpansion,
  radarTargetFadeMs: config.radarTargetFadeMs,
  radarTargetMaxAgeMs: config.radarTargetMaxAgeMs,
  radarTargetPersistenceMs: config.radarTargetPersistenceMs,
  radarUdpPort: config.radarUdpPort,
  replayFrameIntervalMs: config.replayFrameIntervalMs,
  replayRetentionSeconds: config.replayRetentionSeconds
});

const getRadarStatusDiagnostics = ({
  decoder,
  discovery,
  receiver,
  renderer
}: Pick<RadarStatus, "decoder" | "discovery" | "receiver" | "renderer">): RadarStatusDiagnostics => {
  if (!receiver.running && !discovery.running) {
    return {
      nextActions: ["Start BlipWatch and check startup logs for UDP bind or multicast join errors."],
      phase: "listener-stopped",
      summary: "Radar discovery and spoke listeners are not running."
    };
  }

  if (renderer.imageAvailable) {
    return {
      nextActions: ["Open /api/radar/latest.png or /api/radar/latest.json to inspect current rendered imagery."],
      phase: "receiving-and-rendering",
      summary: "Radar spokes are decoding and rendering."
    };
  }

  if (decoder.packetsDecoded > 0) {
    return {
      nextActions: ["Capture /api/radar/status and /api/radar/latest.json from the same test window."],
      phase: "decoded-but-not-rendered",
      summary: "Radar spokes decoded, but no rendered image is available yet."
    };
  }

  if (receiver.packetsReceived > 0) {
    return {
      nextActions: [
        "Save a short UDP replay payload or pcap from the same interval.",
        "Check decoder rejection logs with LOG_LEVEL=debug."
      ],
      phase: "receiving-but-not-decoding",
      summary: "UDP packets are arriving on the spoke receiver, but none have decoded as radar spokes."
    };
  }

  if (discovery.reportsReceived > 0) {
    return {
      nextActions: [
        "Compare the discovered data endpoint with RADAR_UDP_PORT and RADAR_MULTICAST_GROUPS.",
        "If the radar remains in standby, later work may need an explicit opt-in wake/transmit command."
      ],
      phase: "discovery-only",
      summary: "Navico discovery reports are arriving, but no spoke packets have reached the image receiver."
    };
  }

  return {
    nextActions: [
      "Confirm RADAR_INTERFACE is the laptop address on the radar Ethernet network, not Wi-Fi or a VPN.",
      "Run sudo tcpdump -i <interface> -n udp or Wireshark to confirm whether any HALO UDP traffic is present.",
      "If capture sees traffic, compare its destination group and port with RADAR_REPORT_* and RADAR_MULTICAST_GROUPS."
    ],
    phase: "waiting-for-udp",
    summary: "No Navico discovery reports or radar spoke packets have reached BlipWatch, so latest.png will remain empty."
  };
};
