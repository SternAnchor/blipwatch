import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer } from "ws";

import type { BlipWatchConfig } from "../config/config.js";
import type { CalibrationCaptureStatus } from "../calibration/calibration-capture.js";
import type { Logger } from "../logging/logger.js";
import type { RadarControl, RadarRangeRequest, RadarTuningSettingRequest } from "../radar/control.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
import type { RadarStatus, RadarStreamingStatus } from "../radar/status.js";
import type { ReplayBuffer, ReplayPlaybackAction, ReplayPlaybackSpeed } from "../replay/replay-buffer.js";

export interface HttpApi {
  address(): AddressInfo | undefined;
  getStreamingStats(): RadarStreamingStatus;
  publishRadarUpdate(update: RadarStreamUpdate): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface HttpApiOptions {
  readonly config: BlipWatchConfig;
  readonly calibrationCaptureStatus?: () => CalibrationCaptureStatus;
  readonly logger: Logger;
  readonly radarControl?: Pick<
    RadarControl,
    "getStatus" | "requestGain" | "requestRainClutter" | "requestRange" | "requestSeaClutter" | "requestStandby" | "requestTransmit"
  >;
  readonly renderer: RadarImageRenderer;
  readonly radarStatus: () => RadarStatus;
  readonly replayBuffer: ReplayBuffer;
}

export interface RadarStreamUpdate {
  readonly reason: "control" | "frame" | "playback" | "status";
  readonly replayFrameAt?: string;
}

export const HTTP_SERVER_LIMITS = {
  headersTimeoutMs: 10_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100,
  requestTimeoutMs: 30_000
} as const;

export const HTTP_SERVER_SHUTDOWN_GRACE_MS = 5_000;
const API_PREFIX = "/api";
const SAFETY_NOTICE =
  "BlipWatch is NOT a certified navigation aid, radar ARPA, or safety system. " +
  "It must NOT be used as a substitute for proper watchkeeping, situational awareness, " +
  "or any safety-of-life function. Users must maintain compliance with COLREGS Rule 5 " +
  "(proper lookout) and all applicable maritime regulations at all times. " +
  "See the NOTICE file for full liability disclaimer.";

export const createHttpApi = ({
  config,
  calibrationCaptureStatus,
  logger,
  radarControl,
  renderer,
  radarStatus,
  replayBuffer
}: HttpApiOptions): HttpApi => {
  let server: Server | undefined;
  const stream = createRadarStream({ logger, radarStatus, renderer, replayBuffer });

  return {
    address(): AddressInfo | undefined {
      const currentAddress = server?.address();
      if (!currentAddress || typeof currentAddress === "string") {
        return undefined;
      }

      return currentAddress;
    },
    getStreamingStats(): RadarStreamingStatus {
      return stream.getStats();
    },
    publishRadarUpdate(update: RadarStreamUpdate): void {
      stream.publish(update);
    },
    async start(): Promise<void> {
      server = createServer((request, response) => {
        logger.debug(
          `HTTP request received method=${request.method ?? "UNKNOWN"} url=${request.url ?? "/"} renderer=${renderer.imageSize}px replayRetention=${replayBuffer.retentionSeconds}s`
        );

        const url = new URL(request.url ?? "/", "http://localhost");

        if (request.method === "POST" && url.pathname === apiPath("/radar/control/standby")) {
          void handleRadarControlRequest(response, radarControl, "standby", stream);
          return;
        }

        if (request.method === "POST" && url.pathname === apiPath("/radar/control/transmit")) {
          void handleRadarControlRequest(response, radarControl, "transmit", stream);
          return;
        }

        if (request.method === "POST" && url.pathname === apiPath("/radar/replay/playback")) {
          void handleReplayPlaybackRequest(request, response, replayBuffer, stream);
          return;
        }

        if (request.method === "POST" && url.pathname === apiPath("/radar/control/settings")) {
          void handleRadarControlSettingsRequest(request, response, radarControl, stream);
          return;
        }

        if (request.method !== "GET") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }

        if (url.pathname === "/") {
          sendHtml(response, renderDashboardHtml());
          return;
        }

        if (url.pathname === apiPath("/health")) {
          sendJson(response, 200, {
            calibrationCapture: calibrationCaptureStatus?.() ?? null,
            notice: SAFETY_NOTICE,
            ok: true,
            replay: replayBuffer.getMetadata(),
            renderer: renderer.getLatestMetadata(),
            service: "blipwatch"
          });
          return;
        }

        if (url.pathname === apiPath("/notice")) {
          sendJson(response, 200, {
            notice: SAFETY_NOTICE,
            service: "blipwatch"
          });
          return;
        }

        if (url.pathname === apiPath("/radar/latest.png")) {
          sendPng(response, renderer.getLatestPng());
          return;
        }

        if (url.pathname === apiPath("/radar/latest.json")) {
          sendJson(response, 200, renderer.getLatestMetadata());
          return;
        }

        if (url.pathname === apiPath("/radar/status")) {
          sendJson(response, 200, radarStatus());
          return;
        }

        if (url.pathname === apiPath("/radar/control/settings")) {
          if (!radarControl) {
            sendJson(response, 503, {
              error: "radar_control_unavailable",
              message: "Radar control is not available in this process."
            });
            return;
          }

          const controlStatus = radarControl.getStatus();
          sendJson(response, 200, {
            capabilities: controlStatus.capabilities,
            tuning: controlStatus.tuning
          });
          return;
        }

        if (url.pathname === apiPath("/radar/replay")) {
          sendJson(response, 200, replayBuffer.getMetadata());
          return;
        }

        if (url.pathname === apiPath("/radar/replay/frames")) {
          const options = parseReplayFrameListQuery(url);
          if (!options.ok) {
            sendJson(response, 400, { error: options.error, message: options.message });
            return;
          }

          sendJson(response, 200, { frames: replayBuffer.listFrames(options.value) });
          return;
        }

        if (url.pathname === apiPath("/radar/replay/playback")) {
          sendJson(response, 200, replayBuffer.getPlaybackState());
          return;
        }

        if (url.pathname === apiPath("/radar/replay/frame")) {
          const at = url.searchParams.get("at");
          if (!at) {
            sendJson(response, 400, { error: "missing_at", message: "Query parameter `at` is required." });
            return;
          }

          const frame = replayBuffer.getFrameAt(at);
          if (!frame) {
            sendJson(response, 404, { error: "frame_not_found", message: "No replay frame is available for `at`." });
            return;
          }

          sendPng(response, frame.png, {
            "x-blipwatch-frame-at": frame.capturedAt.toISOString()
          });
          return;
        }

        sendJson(response, 404, { error: "not_found" });
      });
      configureHttpServerLimits(server);
      stream.attach(server);

      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(config.port, () => {
          logger.info(`HTTP API listening on :${config.port}`);
          logger.debug("HTTP API startup complete");
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      if (!server) {
        return;
      }

      await stream.close();
      await closeHttpServer(server);
      logger.debug("HTTP API stopped");
      server = undefined;
    }
  };
};

const REPLAY_PLAYBACK_ACTIONS = new Set<ReplayPlaybackAction>(["jump", "live", "pause", "resume", "scrub"]);
const REPLAY_PLAYBACK_SPEEDS = new Set<ReplayPlaybackSpeed>([1, 2, 5, 10]);
const MAX_JSON_BODY_BYTES = 64 * 1024;
const STREAM_THROTTLE_MS = 250;

interface RadarStream {
  attach(server: Server): void;
  close(): Promise<void>;
  getStats(): RadarStreamingStatus;
  publish(update: RadarStreamUpdate): void;
}

interface RadarStreamOptions {
  readonly logger: Logger;
  readonly radarStatus: () => RadarStatus;
  readonly renderer: RadarImageRenderer;
  readonly replayBuffer: ReplayBuffer;
}

const createRadarStream = ({ logger, radarStatus, renderer, replayBuffer }: RadarStreamOptions): RadarStream => {
  const webSocketServer = new WebSocketServer({ noServer: true });
  let lastBroadcastAt = 0;
  let lastClientConnectedAt: string | null = null;
  let lastMessageAt: string | null = null;
  let messagesSent = 0;
  let totalClientsConnected = 0;
  let updatesDropped = 0;

  webSocketServer.on("connection", (socket) => {
    totalClientsConnected += 1;
    lastClientConnectedAt = new Date().toISOString();
    logger.debug(`radar stream client connected clients=${webSocketServer.clients.size}`);
    sendStreamMessage(socket, createStreamMessage("radar.snapshot", { reason: "status" }, radarStatus, renderer, replayBuffer));
  });

  return {
    attach(server: Server): void {
      server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== apiPath("/radar/stream")) {
          socket.destroy();
          return;
        }

        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer.emit("connection", webSocket, request);
        });
      });
    },
    async close(): Promise<void> {
      for (const client of webSocketServer.clients) {
        client.close(1001, "server shutting down");
      }

      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    getStats(): RadarStreamingStatus {
      return {
        clientsConnected: webSocketServer.clients.size,
        lastClientConnectedAt,
        lastMessageAt,
        messagesSent,
        totalClientsConnected,
        updatesDropped
      };
    },
    publish(update: RadarStreamUpdate): void {
      if (webSocketServer.clients.size === 0) {
        return;
      }

      const now = Date.now();
      if (now - lastBroadcastAt < STREAM_THROTTLE_MS) {
        updatesDropped += 1;
        return;
      }

      lastBroadcastAt = now;
      const message = createStreamMessage("radar.update", update, radarStatus, renderer, replayBuffer);
      for (const client of webSocketServer.clients) {
        if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 1_000_000) {
          updatesDropped += 1;
          continue;
        }

        sendStreamMessage(client, message);
        messagesSent += 1;
        lastMessageAt = new Date().toISOString();
      }
    }
  };
};

const sendStreamMessage = (socket: WebSocket, message: unknown): void => {
  socket.send(JSON.stringify(message));
};

const createStreamMessage = (
  type: "radar.snapshot" | "radar.update",
  update: RadarStreamUpdate,
  radarStatus: () => RadarStatus,
  renderer: RadarImageRenderer,
  replayBuffer: ReplayBuffer
): Record<string, unknown> => ({
  image: {
    latestUrl: apiPath("/radar/latest.png"),
    replayFrameAt: update.replayFrameAt ?? null,
    replayFrameUrl: update.replayFrameAt
      ? `${apiPath("/radar/replay/frame")}?at=${encodeURIComponent(update.replayFrameAt)}`
      : null
  },
  reason: update.reason,
  replay: replayBuffer.getMetadata(),
  renderer: renderer.getLatestMetadata(),
  status: radarStatus(),
  timestamp: new Date().toISOString(),
  type
});

export const configureHttpServerLimits = (server: Server): void => {
  server.requestTimeout = HTTP_SERVER_LIMITS.requestTimeoutMs;
  server.headersTimeout = HTTP_SERVER_LIMITS.headersTimeoutMs;
  server.keepAliveTimeout = HTTP_SERVER_LIMITS.keepAliveTimeoutMs;
  server.maxRequestsPerSocket = HTTP_SERVER_LIMITS.maxRequestsPerSocket;
};

export const closeHttpServer = async (
  server: Server,
  graceMs = HTTP_SERVER_SHUTDOWN_GRACE_MS
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections();
    }, graceMs);

    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const apiPath = (path: string): string => `${API_PREFIX}${path}`;

const sendHtml = (response: ServerResponse, body: string): void => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8"
  });
  response.end(body);
};

const sendPng = (
  response: ServerResponse,
  body: Buffer,
  headers: Record<string, string> = {}
): void => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": body.byteLength.toString(),
    "content-type": "image/png",
    ...headers
  });
  response.end(body);
};

const handleRadarControlRequest = async (
  response: ServerResponse,
  radarControl: HttpApiOptions["radarControl"],
  desiredState: "standby" | "transmit",
  stream: RadarStream
): Promise<void> => {
  if (!radarControl) {
    sendJson(response, 503, {
      error: "radar_control_unavailable",
      message: "Radar control is not available in this process."
    });
    return;
  }

  try {
    if (desiredState === "standby") {
      await radarControl.requestStandby();
    } else {
      await radarControl.requestTransmit();
    }

    sendJson(response, 200, { ok: true, desiredState });
    stream.publish({ reason: "control" });
  } catch (error) {
    sendJson(response, 409, {
      error: "radar_control_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

const handleRadarControlSettingsRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  radarControl: HttpApiOptions["radarControl"],
  stream: RadarStream
): Promise<void> => {
  if (!radarControl) {
    sendJson(response, 503, {
      error: "radar_control_unavailable",
      message: "Radar control is not available in this process."
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const parsed = parseRadarControlSettingsRequest(body);
    if (!parsed.ok) {
      sendJson(response, 400, { error: parsed.error, message: parsed.message });
      return;
    }

    const result = await requestRadarControlSetting(radarControl, parsed.value);
    stream.publish({ reason: "control" });
    sendJson(response, 501, {
      error: "radar_control_setting_unsupported",
      ...result,
      status: radarControl.getStatus().tuning
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendJson(response, error.statusCode, { error: error.code, message: error.message });
      return;
    }

    sendJson(response, 500, { error: "radar_control_setting_failed", message: "Radar control setting failed." });
  }
};

type RadarControlSettingsRequest =
  | { readonly request: RadarTuningSettingRequest; readonly setting: "gain" | "rainClutter" | "seaClutter" }
  | { readonly request: RadarRangeRequest; readonly setting: "range" };

const requestRadarControlSetting = async (
  radarControl: NonNullable<HttpApiOptions["radarControl"]>,
  request: RadarControlSettingsRequest
) => {
  switch (request.setting) {
    case "gain":
      return radarControl.requestGain(request.request);
    case "rainClutter":
      return radarControl.requestRainClutter(request.request);
    case "range":
      return radarControl.requestRange(request.request);
    case "seaClutter":
      return radarControl.requestSeaClutter(request.request);
  }
};

const parseRadarControlSettingsRequest = (
  body: unknown
):
  | { readonly ok: true; readonly value: RadarControlSettingsRequest }
  | { readonly error: string; readonly message: string; readonly ok: false } => {
  if (!isObject(body)) {
    return { error: "invalid_body", message: "Expected a JSON object body.", ok: false };
  }

  if (body.setting !== "gain" && body.setting !== "seaClutter" && body.setting !== "rainClutter" && body.setting !== "range") {
    return {
      error: "invalid_setting",
      message: "Field `setting` must be one of: gain, seaClutter, rainClutter, range.",
      ok: false
    };
  }

  if (body.setting === "range") {
    if (typeof body.rangeMeters !== "number" || !Number.isInteger(body.rangeMeters) || body.rangeMeters <= 0) {
      return { error: "invalid_range", message: "Field `rangeMeters` must be a positive integer.", ok: false };
    }

    return {
      ok: true,
      value: {
        request: { rangeMeters: body.rangeMeters },
        setting: "range"
      }
    };
  }

  if (body.mode !== "auto" && body.mode !== "manual") {
    return { error: "invalid_mode", message: "Field `mode` must be `auto` or `manual`.", ok: false };
  }

  if (
    body.mode === "manual" &&
    (typeof body.value !== "number" || !Number.isInteger(body.value) || body.value < 0 || body.value > 100)
  ) {
    return { error: "invalid_value", message: "Manual tuning field `value` must be an integer from 0 to 100.", ok: false };
  }

  const tuningValue = body.mode === "manual" && typeof body.value === "number" ? body.value : null;

  return {
    ok: true,
    value: {
      request: {
        mode: body.mode,
        value: tuningValue
      },
      setting: body.setting
    }
  };
};

const handleReplayPlaybackRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  replayBuffer: ReplayBuffer,
  stream: RadarStream
): Promise<void> => {
  try {
    const body = await readJsonBody(request);
    const command = parseReplayPlaybackCommand(body);
    if (!command.ok) {
      sendJson(response, 400, { error: command.error, message: command.message });
      return;
    }

    const playbackState = replayBuffer.updatePlayback(command.value);
    sendJson(response, 200, playbackState);
    stream.publish({ reason: "playback", replayFrameAt: playbackState.currentFrameAt ?? undefined });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendJson(response, error.statusCode, { error: error.code, message: error.message });
      return;
    }

    sendJson(response, 500, { error: "replay_playback_failed", message: "Replay playback update failed." });
  }
};

interface ReplayPlaybackRequestBody {
  readonly action?: unknown;
  readonly at?: unknown;
  readonly speed?: unknown;
}

const parseReplayPlaybackCommand = (
  body: unknown
):
  | { readonly ok: true; readonly value: { readonly action: ReplayPlaybackAction; readonly at?: string; readonly speed?: ReplayPlaybackSpeed } }
  | { readonly error: string; readonly message: string; readonly ok: false } => {
  if (!isObject(body)) {
    return { error: "invalid_body", message: "Expected a JSON object body.", ok: false };
  }

  const requestBody = body as ReplayPlaybackRequestBody;
  if (typeof requestBody.action !== "string" || !REPLAY_PLAYBACK_ACTIONS.has(requestBody.action as ReplayPlaybackAction)) {
    return {
      error: "invalid_action",
      message: "Field `action` must be one of: jump, live, pause, resume, scrub.",
      ok: false
    };
  }

  const action = requestBody.action as ReplayPlaybackAction;
  const at = parseOptionalIsoTimestamp(requestBody.at);
  if (!at.ok) {
    return at;
  }

  if ((action === "jump" || action === "scrub") && !at.value) {
    return { error: "missing_at", message: "Field `at` is required for jump and scrub playback actions.", ok: false };
  }

  const speed = parseOptionalReplaySpeed(requestBody.speed);
  if (!speed.ok) {
    return speed;
  }

  return {
    ok: true,
    value: {
      action,
      ...(at.value ? { at: at.value } : {}),
      ...(speed.value ? { speed: speed.value } : {})
    }
  };
};

const parseReplayFrameListQuery = (
  url: URL
):
  | { readonly ok: true; readonly value: { readonly from?: string; readonly limit?: number; readonly to?: string } }
  | { readonly error: string; readonly message: string; readonly ok: false } => {
  const from = parseOptionalIsoTimestamp(url.searchParams.get("from"));
  if (!from.ok) {
    return from;
  }

  const to = parseOptionalIsoTimestamp(url.searchParams.get("to"));
  if (!to.ok) {
    return to;
  }

  const limit = parseOptionalPositiveInteger(url.searchParams.get("limit"), "limit");
  if (!limit.ok) {
    return limit;
  }

  return {
    ok: true,
    value: {
      ...(from.value ? { from: from.value } : {}),
      ...(limit.value ? { limit: limit.value } : {}),
      ...(to.value ? { to: to.value } : {})
    }
  };
};

const parseOptionalIsoTimestamp = (
  value: unknown
):
  | { readonly ok: true; readonly value?: string }
  | { readonly error: string; readonly message: string; readonly ok: false } => {
  if (value === undefined || value === null || value === "") {
    return { ok: true };
  }

  if (typeof value !== "string") {
    return { error: "invalid_timestamp", message: "Timestamp fields must be ISO-8601 strings.", ok: false };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: "invalid_timestamp", message: "Timestamp fields must be valid ISO-8601 strings.", ok: false };
  }

  return { ok: true, value: parsed.toISOString() };
};

const parseOptionalPositiveInteger = (
  value: string | null,
  fieldName: string
):
  | { readonly ok: true; readonly value?: number }
  | { readonly error: string; readonly message: string; readonly ok: false } => {
  if (value === null || value === "") {
    return { ok: true };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed.toString() !== value) {
    return { error: "invalid_limit", message: `Query parameter \`${fieldName}\` must be a positive integer.`, ok: false };
  }

  return { ok: true, value: parsed };
};

const parseOptionalReplaySpeed = (
  value: unknown
):
  | { readonly ok: true; readonly value?: ReplayPlaybackSpeed }
  | { readonly error: string; readonly message: string; readonly ok: false } => {
  if (value === undefined || value === null || value === "") {
    return { ok: true };
  }

  if (typeof value !== "number" || !REPLAY_PLAYBACK_SPEEDS.has(value as ReplayPlaybackSpeed)) {
    return { error: "invalid_speed", message: "Field `speed` must be one of: 1, 2, 5, 10.", ok: false };
  }

  return { ok: true, value: value as ReplayPlaybackSpeed };
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyError(413, "body_too_large", "Request body is too large.");
    }
    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    throw new RequestBodyError(400, "missing_body", "Expected a JSON request body.");
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new RequestBodyError(400, "invalid_json", "Request body must be valid JSON.", { cause: error });
  }
};

class RequestBodyError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const renderDashboardHtml = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>BlipWatch</title>
    <style>
      :root {
        color-scheme: dark;
        --background: #101214;
        --panel: #191d21;
        --panel-strong: #20262b;
        --text: #f4f7f8;
        --muted: #9aa7ad;
        --accent: #37c871;
        --warning: #f4c542;
        --danger: #ff6b6b;
        --border: #303941;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--background);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(320px, 1.2fr) minmax(320px, 0.8fr);
        min-height: 100vh;
        padding: 16px;
      }

      section,
      aside {
        min-width: 0;
      }

      .viewer,
      .status-panel,
      .replay-panel,
      .details {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
      }

      .viewer {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: calc(100vh - 32px);
        overflow: hidden;
      }

      .toolbar,
      .panel-header {
        align-items: center;
        background: var(--panel-strong);
        border-bottom: 1px solid var(--border);
        display: flex;
        gap: 12px;
        justify-content: space-between;
        min-height: 56px;
        padding: 12px 14px;
      }

      h1,
      h2 {
        font-size: 16px;
        line-height: 1.2;
        margin: 0;
      }

      .subtle {
        color: var(--muted);
        font-size: 13px;
      }

      .radar-frame {
        align-items: center;
        background: #050607;
        display: flex;
        justify-content: center;
        min-height: 0;
        padding: 12px;
      }

      .radar-frame img {
        aspect-ratio: 1;
        height: auto;
        image-rendering: pixelated;
        max-height: calc(100vh - 116px);
        max-width: 100%;
        object-fit: contain;
        width: auto;
      }

      .side {
        display: grid;
        gap: 16px;
        grid-template-rows: auto auto minmax(260px, 1fr);
      }

      .status-panel {
        overflow: hidden;
      }

      .status-body {
        display: grid;
        gap: 12px;
        padding: 14px;
      }

      .phase {
        border-left: 4px solid var(--warning);
        padding-left: 10px;
      }

      .phase.ready {
        border-left-color: var(--accent);
      }

      .phase.error {
        border-left-color: var(--danger);
      }

      .phase strong {
        display: block;
        font-size: 15px;
        margin-bottom: 4px;
      }

      .stats {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .control-actions {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .replay-actions,
      .speed-actions {
        display: grid;
        gap: 8px;
      }

      .replay-actions {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .speed-actions {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      button {
        appearance: none;
        background: #111518;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        min-height: 44px;
        padding: 10px 12px;
      }

      button:hover:not(:disabled) {
        border-color: var(--accent);
      }

      button.active {
        background: #173622;
        border-color: var(--accent);
      }

      button:disabled {
        color: #657178;
        cursor: not-allowed;
      }

      input[type="datetime-local"],
      input[type="range"] {
        accent-color: var(--accent);
        background: #111518;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text);
        font: inherit;
        min-height: 44px;
        padding: 8px 10px;
        width: 100%;
      }

      input[type="range"] {
        padding-inline: 0;
      }

      .replay-body {
        display: grid;
        gap: 12px;
        padding: 14px;
      }

      .replay-row {
        display: grid;
        gap: 8px;
      }

      .jump-row {
        display: grid;
        gap: 8px;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .stat {
        background: #111518;
        border: 1px solid var(--border);
        border-radius: 6px;
        min-width: 0;
        padding: 10px;
      }

      .stat span {
        color: var(--muted);
        display: block;
        font-size: 12px;
        margin-bottom: 6px;
      }

      .stat strong {
        display: block;
        font-size: 18px;
        overflow-wrap: anywhere;
      }

      ul {
        color: var(--muted);
        margin: 0;
        padding-left: 20px;
      }

      li + li {
        margin-top: 6px;
      }

      .details {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 0;
        overflow: hidden;
      }

      pre {
        margin: 0;
        min-height: 0;
        overflow: auto;
        padding: 14px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      a {
        color: var(--accent);
      }

      @media (max-width: 900px) {
        main {
          grid-template-columns: 1fr;
        }

        .viewer {
          min-height: auto;
        }

        .radar-frame img {
          max-height: 70vh;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="viewer" aria-labelledby="radar-title">
        <div class="toolbar">
          <div>
            <h1 id="radar-title">BlipWatch</h1>
            <div class="subtle" id="last-updated">Waiting for status...</div>
          </div>
          <a href="/api/radar/latest.png">PNG</a>
        </div>
        <div class="radar-frame">
          <img id="radar-image" alt="Latest radar image" src="/api/radar/latest.png">
        </div>
      </section>

      <aside class="side">
        <section class="status-panel" aria-labelledby="status-title">
          <div class="panel-header">
            <h2 id="status-title">Radar Status</h2>
            <a href="/api/radar/status">JSON</a>
          </div>
          <div class="status-body">
            <div class="phase" id="phase">
              <strong id="phase-name">Loading</strong>
              <div class="subtle" id="phase-summary">Requesting radar status...</div>
            </div>
            <div class="control-actions" aria-label="Radar controls">
              <button id="standby-button" type="button">Standby</button>
              <button id="transmit-button" type="button">Transmit</button>
            </div>
            <div class="stats">
              <div class="stat"><span>Discovery Reports</span><strong id="reports">0</strong></div>
              <div class="stat"><span>Packets Received</span><strong id="packets">0</strong></div>
              <div class="stat"><span>Decoded Spokes</span><strong id="decoded">0</strong></div>
              <div class="stat"><span>Rendered Spokes</span><strong id="rendered">0</strong></div>
              <div class="stat"><span>Interface</span><strong id="interface">-</strong></div>
              <div class="stat"><span>Image Group</span><strong id="image-group">-</strong></div>
              <div class="stat"><span>Report Group</span><strong id="report-group">-</strong></div>
              <div class="stat"><span>Radar State</span><strong id="radar-state">-</strong></div>
              <div class="stat"><span>Control</span><strong id="control">-</strong></div>
              <div class="stat"><span>Commands Sent</span><strong id="commands">0</strong></div>
              <div class="stat"><span>Active Pixels</span><strong id="active-pixels">0</strong></div>
              <div class="stat"><span>Replay Frames</span><strong id="replay-frames">0</strong></div>
              <div class="stat"><span>Replay Memory</span><strong id="replay-memory">0 B</strong></div>
              <div class="stat"><span>Heap Used</span><strong id="heap-used">0 B</strong></div>
              <div class="stat"><span>Uptime</span><strong id="uptime">0s</strong></div>
              <div class="stat"><span>Stream Clients</span><strong id="stream-clients">0</strong></div>
              <div class="stat"><span>Gain</span><strong id="gain">-</strong></div>
              <div class="stat"><span>Sea Clutter</span><strong id="sea-clutter">-</strong></div>
              <div class="stat"><span>Rain Clutter</span><strong id="rain-clutter">-</strong></div>
              <div class="stat"><span>Range Control</span><strong id="range-control">-</strong></div>
            </div>
            <div>
              <div class="subtle">Next Actions</div>
              <ul id="actions"></ul>
            </div>
          </div>
        </section>

        <section class="replay-panel" aria-labelledby="replay-title">
          <div class="panel-header">
            <div>
              <h2 id="replay-title">Replay</h2>
              <div class="subtle" id="replay-state">Live</div>
            </div>
            <a href="/api/radar/replay">JSON</a>
          </div>
          <div class="replay-body">
            <div class="replay-actions" aria-label="Replay controls">
              <button id="live-button" type="button">Live</button>
              <button id="pause-button" type="button">Pause</button>
              <button id="play-button" type="button">Play</button>
            </div>
            <div class="replay-row">
              <input id="replay-slider" type="range" min="0" max="0" value="0" aria-label="Replay timeline">
              <div class="subtle" id="replay-time">No replay frames</div>
            </div>
            <div class="jump-row">
              <input id="jump-time" type="datetime-local" step="1" aria-label="Jump to time">
              <button id="jump-button" type="button">Jump</button>
            </div>
            <div class="speed-actions" aria-label="Replay speed">
              <button class="speed-button" data-speed="1" type="button">1x</button>
              <button class="speed-button" data-speed="2" type="button">2x</button>
              <button class="speed-button" data-speed="5" type="button">5x</button>
              <button class="speed-button" data-speed="10" type="button">10x</button>
            </div>
          </div>
        </section>

        <section class="details" aria-labelledby="details-title">
          <div class="panel-header">
            <h2 id="details-title">Raw Status</h2>
          </div>
          <pre id="raw-status">{}</pre>
        </section>
      </aside>
    </main>

    <script>
      const image = document.getElementById("radar-image");
      const phase = document.getElementById("phase");
      const phaseName = document.getElementById("phase-name");
      const phaseSummary = document.getElementById("phase-summary");
      const lastUpdated = document.getElementById("last-updated");
      const actions = document.getElementById("actions");
      const rawStatus = document.getElementById("raw-status");
      const standbyButton = document.getElementById("standby-button");
      const transmitButton = document.getElementById("transmit-button");
      const liveButton = document.getElementById("live-button");
      const pauseButton = document.getElementById("pause-button");
      const playButton = document.getElementById("play-button");
      const replaySlider = document.getElementById("replay-slider");
      const replayState = document.getElementById("replay-state");
      const replayTime = document.getElementById("replay-time");
      const jumpTime = document.getElementById("jump-time");
      const jumpButton = document.getElementById("jump-button");
      const speedButtons = Array.from(document.querySelectorAll(".speed-button"));
      let controlRequestPending = false;
      let playbackRequestPending = false;
      let replayFrames = [];
      let playback = {
        currentFrameAt: null,
        mode: "live",
        requestedAt: null,
        speed: 1,
        status: "live"
      };
      const fields = {
        activePixels: document.getElementById("active-pixels"),
        commands: document.getElementById("commands"),
        control: document.getElementById("control"),
        decoded: document.getElementById("decoded"),
        gain: document.getElementById("gain"),
        heapUsed: document.getElementById("heap-used"),
        imageGroup: document.getElementById("image-group"),
        interface: document.getElementById("interface"),
        packets: document.getElementById("packets"),
        radarState: document.getElementById("radar-state"),
        rainClutter: document.getElementById("rain-clutter"),
        rangeControl: document.getElementById("range-control"),
        replayFrames: document.getElementById("replay-frames"),
        replayMemory: document.getElementById("replay-memory"),
        rendered: document.getElementById("rendered"),
        reportGroup: document.getElementById("report-group"),
        reports: document.getElementById("reports"),
        streamClients: document.getElementById("stream-clients"),
        uptime: document.getElementById("uptime")
      };

      const setText = (element, value) => {
        element.textContent = value ?? "-";
      };
      const formatTuningSetting = (capability, setting) => {
        if (!capability?.supported) {
          return "unsupported";
        }

        return setting?.mode === "manual" ? "manual " + setting?.value : "auto";
      };
      const formatRangeControl = (capability, setting) => {
        if (!capability?.supported) {
          return "unsupported";
        }

        return setting?.rangeMeters ? setting.rangeMeters + " m" : "auto";
      };
      const formatBytes = (value) => {
        if (typeof value !== "number") {
          return "-";
        }

        if (value < 1024) {
          return value + " B";
        }

        if (value < 1024 * 1024) {
          return (value / 1024).toFixed(1) + " KiB";
        }

        return (value / 1024 / 1024).toFixed(1) + " MiB";
      };
      const formatDuration = (seconds) => {
        if (typeof seconds !== "number") {
          return "-";
        }

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return minutes > 0 ? minutes + "m " + remainingSeconds + "s" : remainingSeconds + "s";
      };

      const setControlButtons = (control) => {
        const active = Boolean(control?.enabled && control?.running);
        const disabled = controlRequestPending || !active;
        const visibleState = control?.observedState ?? control?.desiredState;
        standbyButton.disabled = disabled;
        transmitButton.disabled = disabled;
        standbyButton.classList.toggle("active", visibleState === "standby");
        transmitButton.classList.toggle("active", visibleState === "transmit");
      };

      const formatFrameTime = (timestamp) => timestamp ? new Date(timestamp).toLocaleTimeString() : "-";
      const toDateTimeLocal = (timestamp) => {
        if (!timestamp) {
          return "";
        }

        const date = new Date(timestamp);
        const offsetMs = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offsetMs).toISOString().slice(0, 19);
      };
      const fromDateTimeLocal = (value) => value ? new Date(value).toISOString() : null;
      const currentReplayIndex = () => {
        if (!replayFrames.length || !playback.currentFrameAt) {
          return Math.max(replayFrames.length - 1, 0);
        }

        const exactIndex = replayFrames.findIndex((frame) => frame.capturedAt === playback.currentFrameAt);
        return exactIndex >= 0 ? exactIndex : Math.max(replayFrames.length - 1, 0);
      };
      const updateRadarImage = () => {
        if (playback.mode === "replay" && playback.currentFrameAt) {
          image.src = "/api/radar/replay/frame?at=" + encodeURIComponent(playback.currentFrameAt) + "&ts=" + Date.now();
          return;
        }

        image.src = "/api/radar/latest.png?ts=" + Date.now();
      };
      const setReplayControls = () => {
        const hasFrames = replayFrames.length > 0;
        const disabled = playbackRequestPending || !hasFrames;
        const index = currentReplayIndex();
        replaySlider.max = String(Math.max(replayFrames.length - 1, 0));
        replaySlider.value = String(index);
        replaySlider.disabled = disabled;
        pauseButton.disabled = disabled;
        playButton.disabled = disabled;
        jumpButton.disabled = playbackRequestPending;
        jumpTime.disabled = playbackRequestPending;
        liveButton.disabled = playbackRequestPending;
        replayState.textContent = playback.mode === "live"
          ? "Live"
          : playback.status + " at " + formatFrameTime(playback.currentFrameAt) + " / " + playback.speed + "x";
        replayTime.textContent = hasFrames
          ? (index + 1) + " of " + replayFrames.length + " - " + formatFrameTime(replayFrames[index]?.capturedAt)
          : "No replay frames";
        jumpTime.value = toDateTimeLocal(playback.currentFrameAt ?? replayFrames[index]?.capturedAt);
        liveButton.classList.toggle("active", playback.mode === "live");
        pauseButton.classList.toggle("active", playback.status === "paused");
        playButton.classList.toggle("active", playback.status === "playing");
        speedButtons.forEach((button) => {
          button.disabled = disabled;
          button.classList.toggle("active", Number(button.dataset.speed) === playback.speed);
        });
      };
      const loadReplay = async () => {
        const framesResponse = await fetch("/api/radar/replay/frames?limit=300", { cache: "no-store" });
        const framesBody = await framesResponse.json();
        replayFrames = framesBody.frames ?? [];
        const playbackResponse = await fetch("/api/radar/replay/playback", { cache: "no-store" });
        playback = await playbackResponse.json();
        setReplayControls();
      };
      const requestPlayback = async (command) => {
        playbackRequestPending = true;
        setReplayControls();
        try {
          const response = await fetch("/api/radar/replay/playback", {
            body: JSON.stringify(command),
            headers: { "content-type": "application/json" },
            method: "POST"
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message ?? "Replay request failed");
          }
          playback = await response.json();
          setReplayControls();
          updateRadarImage();
        } catch (error) {
          phase.className = "phase error";
          setText(phaseName, "replay-error");
          setText(phaseSummary, error instanceof Error ? error.message : String(error));
        } finally {
          playbackRequestPending = false;
          setReplayControls();
        }
      };

      const requestControl = async (desiredState) => {
        controlRequestPending = true;
        standbyButton.disabled = true;
        transmitButton.disabled = true;
        try {
          const response = await fetch("/api/radar/control/" + desiredState, { method: "POST" });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message ?? "Radar control request failed");
          }
          await refresh();
        } catch (error) {
          phase.className = "phase error";
          setText(phaseName, "control-error");
          setText(phaseSummary, error instanceof Error ? error.message : String(error));
        } finally {
          controlRequestPending = false;
        }
      };

      const refresh = async () => {
        try {
          const response = await fetch("/api/radar/status", { cache: "no-store" });
          const status = await response.json();
          const diagnostic = status.diagnostics ?? {};
          const currentPhase = diagnostic.phase ?? "unknown";
          phase.className = "phase" + (currentPhase === "receiving-and-rendering" ? " ready" : "") + (currentPhase === "listener-stopped" ? " error" : "");
          setText(phaseName, currentPhase);
          setText(phaseSummary, diagnostic.summary);
          setText(fields.reports, status.discovery?.reportsReceived);
          setText(fields.packets, status.receiver?.packetsReceived);
          setText(fields.decoded, status.decoder?.packetsDecoded);
          setText(fields.rendered, status.renderer?.spokeCount);
          setText(
            fields.interface,
            status.receiver?.multicastInterface ??
              status.discovery?.multicastInterface ??
              status.receiver?.boundInterface ??
              status.discovery?.boundInterface
          );
          setText(fields.imageGroup, (status.receiver?.multicastGroups ?? []).join(", ") || "-");
          setText(fields.reportGroup, status.discovery?.multicastGroup);
          setText(
            fields.radarState,
            status.control?.observedState
              ? status.control.observedState + "/" + (status.control.observedStateSource ?? "unknown")
              : status.discovery?.radar?.statusName
          );
          setText(
            fields.control,
            status.control?.enabled
              ? (status.control?.running
                ? "requested " + status.control?.desiredState + "/" + (status.control?.commandTargetSource ?? "unknown")
                : "enabled")
              : "disabled"
          );
          setControlButtons(status.control);
          setText(fields.commands, status.control?.commandsSent);
          setText(fields.activePixels, status.renderer?.activePixelCount);
          setText(fields.replayFrames, status.replay?.frameCount);
          setText(fields.replayMemory, formatBytes(status.replay?.totalBytes));
          setText(fields.heapUsed, formatBytes(status.process?.memory?.heapUsed));
          setText(fields.uptime, formatDuration(status.process?.uptimeSeconds));
          setText(fields.streamClients, status.streaming?.clientsConnected);
          setText(fields.gain, formatTuningSetting(status.control?.capabilities?.gain, status.control?.tuning?.gain));
          setText(
            fields.seaClutter,
            formatTuningSetting(status.control?.capabilities?.seaClutter, status.control?.tuning?.seaClutter)
          );
          setText(
            fields.rainClutter,
            formatTuningSetting(status.control?.capabilities?.rainClutter, status.control?.tuning?.rainClutter)
          );
          setText(
            fields.rangeControl,
            formatRangeControl(status.control?.capabilities?.range, status.control?.tuning?.range)
          );
          await loadReplay();
          actions.replaceChildren(...(diagnostic.nextActions ?? []).map((action) => {
            const item = document.createElement("li");
            item.textContent = action;
            return item;
          }));
          rawStatus.textContent = JSON.stringify(status, null, 2);
          lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString();
          updateRadarImage();
        } catch (error) {
          phase.className = "phase error";
          setText(phaseName, "status-error");
          setText(phaseSummary, error instanceof Error ? error.message : String(error));
          setControlButtons(undefined);
        }
      };

      standbyButton.addEventListener("click", () => {
        void requestControl("standby");
      });
      transmitButton.addEventListener("click", () => {
        void requestControl("transmit");
      });
      liveButton.addEventListener("click", () => {
        void requestPlayback({ action: "live" });
      });
      pauseButton.addEventListener("click", () => {
        void requestPlayback({ action: "pause", at: playback.currentFrameAt ?? replayFrames.at(-1)?.capturedAt });
      });
      playButton.addEventListener("click", () => {
        void requestPlayback({ action: "resume", at: playback.currentFrameAt ?? replayFrames.at(-1)?.capturedAt });
      });
      replaySlider.addEventListener("input", () => {
        const frame = replayFrames[Number(replaySlider.value)];
        replayTime.textContent = frame ? formatFrameTime(frame.capturedAt) : "No replay frames";
      });
      replaySlider.addEventListener("change", () => {
        const frame = replayFrames[Number(replaySlider.value)];
        if (frame) {
          void requestPlayback({ action: "scrub", at: frame.capturedAt });
        }
      });
      jumpButton.addEventListener("click", () => {
        const at = fromDateTimeLocal(jumpTime.value);
        if (at) {
          void requestPlayback({ action: "jump", at });
        }
      });
      speedButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const speed = Number(button.dataset.speed);
          const action = playback.status === "playing" ? "resume" : "pause";
          void requestPlayback({ action, at: playback.currentFrameAt ?? replayFrames.at(-1)?.capturedAt, speed });
        });
      });
      void refresh();
      setInterval(refresh, 2000);
    </script>
  </body>
</html>`;
