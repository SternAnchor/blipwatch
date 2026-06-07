import type { Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
import type { RadarStatus } from "../radar/status.js";
import type { ReplayBuffer } from "../replay/replay-buffer.js";

export interface HttpApi {
  address(): AddressInfo | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface HttpApiOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
  readonly renderer: RadarImageRenderer;
  readonly radarStatus: () => RadarStatus;
  readonly replayBuffer: ReplayBuffer;
}

export const HTTP_SERVER_LIMITS = {
  headersTimeoutMs: 10_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100,
  requestTimeoutMs: 30_000
} as const;

export const HTTP_SERVER_SHUTDOWN_GRACE_MS = 5_000;

export const createHttpApi = ({ config, logger, renderer, radarStatus, replayBuffer }: HttpApiOptions): HttpApi => {
  let server: Server | undefined;

  return {
    address(): AddressInfo | undefined {
      const currentAddress = server?.address();
      if (!currentAddress || typeof currentAddress === "string") {
        return undefined;
      }

      return currentAddress;
    },
    async start(): Promise<void> {
      server = createServer((request, response) => {
        logger.debug(
          `HTTP request received method=${request.method ?? "UNKNOWN"} url=${request.url ?? "/"} renderer=${renderer.imageSize}px replayRetention=${replayBuffer.retentionSeconds}s`
        );

        const url = new URL(request.url ?? "/", "http://localhost");

        if (request.method !== "GET") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }

        if (url.pathname === "/") {
          sendHtml(response, renderDashboardHtml());
          return;
        }

        if (url.pathname === "/health") {
          sendJson(response, 200, {
            ok: true,
            replay: replayBuffer.getMetadata(),
            renderer: renderer.getLatestMetadata(),
            service: "blipwatch"
          });
          return;
        }

        if (url.pathname === "/radar/latest.png") {
          sendPng(response, renderer.getLatestPng());
          return;
        }

        if (url.pathname === "/radar/latest.json") {
          sendJson(response, 200, renderer.getLatestMetadata());
          return;
        }

        if (url.pathname === "/radar/status") {
          sendJson(response, 200, radarStatus());
          return;
        }

        if (url.pathname === "/radar/replay") {
          sendJson(response, 200, replayBuffer.getMetadata());
          return;
        }

        if (url.pathname === "/radar/replay/frames") {
          sendJson(response, 200, { frames: replayBuffer.listFrames() });
          return;
        }

        if (url.pathname === "/radar/replay/frame") {
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

      await closeHttpServer(server);
      logger.debug("HTTP API stopped");
      server = undefined;
    }
  };
};

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
        grid-template-rows: auto minmax(260px, 1fr);
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
          <a href="/radar/latest.png">PNG</a>
        </div>
        <div class="radar-frame">
          <img id="radar-image" alt="Latest radar image" src="/radar/latest.png">
        </div>
      </section>

      <aside class="side">
        <section class="status-panel" aria-labelledby="status-title">
          <div class="panel-header">
            <h2 id="status-title">Radar Status</h2>
            <a href="/radar/status">JSON</a>
          </div>
          <div class="status-body">
            <div class="phase" id="phase">
              <strong id="phase-name">Loading</strong>
              <div class="subtle" id="phase-summary">Requesting radar status...</div>
            </div>
            <div class="stats">
              <div class="stat"><span>Discovery Reports</span><strong id="reports">0</strong></div>
              <div class="stat"><span>Packets Received</span><strong id="packets">0</strong></div>
              <div class="stat"><span>Decoded Spokes</span><strong id="decoded">0</strong></div>
              <div class="stat"><span>Rendered Spokes</span><strong id="rendered">0</strong></div>
              <div class="stat"><span>Image Group</span><strong id="image-group">-</strong></div>
              <div class="stat"><span>Report Group</span><strong id="report-group">-</strong></div>
            </div>
            <div>
              <div class="subtle">Next Actions</div>
              <ul id="actions"></ul>
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
      const fields = {
        decoded: document.getElementById("decoded"),
        imageGroup: document.getElementById("image-group"),
        packets: document.getElementById("packets"),
        rendered: document.getElementById("rendered"),
        reportGroup: document.getElementById("report-group"),
        reports: document.getElementById("reports")
      };

      const setText = (element, value) => {
        element.textContent = value ?? "-";
      };

      const refresh = async () => {
        try {
          const response = await fetch("/radar/status", { cache: "no-store" });
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
          setText(fields.imageGroup, (status.receiver?.multicastGroups ?? []).join(", ") || "-");
          setText(fields.reportGroup, status.discovery?.multicastGroup);
          actions.replaceChildren(...(diagnostic.nextActions ?? []).map((action) => {
            const item = document.createElement("li");
            item.textContent = action;
            return item;
          }));
          rawStatus.textContent = JSON.stringify(status, null, 2);
          lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString();
          image.src = "/radar/latest.png?ts=" + Date.now();
        } catch (error) {
          phase.className = "phase error";
          setText(phaseName, "status-error");
          setText(phaseSummary, error instanceof Error ? error.message : String(error));
        }
      };

      void refresh();
      setInterval(refresh, 2000);
    </script>
  </body>
</html>`;
