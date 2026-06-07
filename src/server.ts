import { createHttpApi } from "./api/http-api.js";
import { ConfigurationError, loadConfig } from "./config/config.js";
import { createLogger, type Logger } from "./logging/logger.js";
import { createRadarDecoder } from "./radar/decoder.js";
import { createRadarDiscovery } from "./radar/discovery.js";
import { resolveRadarInterface } from "./radar/network-interface.js";
import { createRadarImageRenderer } from "./radar/renderer.js";
import { createRadarReceiver } from "./radar/receiver.js";
import type { RadarStatus, RadarStatusDiagnostics } from "./radar/status.js";
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
  const decoder = createRadarDecoder({ logger });
  const discovery = createRadarDiscovery({ config, logger });
  const renderer = createRadarImageRenderer({ config, logger });
  const replayBuffer = createReplayBuffer({ config, logger });
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
      decoder: decoderStatus,
      diagnostics: getRadarStatusDiagnostics({
        decoder: decoderStatus,
        discovery: discoveryStatus,
        receiver: receiverStatus,
        renderer: rendererStatus
      }),
      discovery: discoveryStatus,
      receiver: receiverStatus,
      renderer: rendererStatus
    };
  };
  const httpApi = createHttpApi({ config, logger, renderer, radarStatus: getRadarStatus, replayBuffer });

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
      receiver.onPacket((packet) => {
        const result = decoder.decode(packet);
        if (result.ok) {
          packetsDecoded += 1;
          lastDecodedSpokeAt = result.spoke.receivedAt;
          renderer.applySpoke(result.spoke);
          replayBuffer.captureFrame({
            metadata: renderer.getLatestMetadata(),
            png: renderer.getLatestPng()
          });
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
      await receiver.stop();
      await discovery.stop();
      await httpApi.stop();
      logger.info("BlipWatch stopped");
    }
  };
};

export { ConfigurationError };

const redactConfig = (config: ReturnType<typeof loadConfig>): Record<string, number | string> => ({
  imageSize: config.imageSize,
  logLevel: config.logLevel,
  port: config.port,
  radarDiscoveryEnabled: String(config.radarDiscoveryEnabled),
  radarInterface: config.radarInterface,
  radarMulticastGroups: config.radarMulticastGroups.join(","),
  radarReportMulticastGroup: config.radarReportMulticastGroup,
  radarReportUdpPort: config.radarReportUdpPort,
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
      nextActions: ["Open /radar/latest.png or /radar/latest.json to inspect current rendered imagery."],
      phase: "receiving-and-rendering",
      summary: "Radar spokes are decoding and rendering."
    };
  }

  if (decoder.packetsDecoded > 0) {
    return {
      nextActions: ["Capture /radar/status and /radar/latest.json from the same test window."],
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
