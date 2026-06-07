import type { Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
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
  readonly replayBuffer: ReplayBuffer;
}

export const createHttpApi = ({ config, logger, renderer, replayBuffer }: HttpApiOptions): HttpApi => {
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

      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      logger.debug("HTTP API stopped");
      server = undefined;
    }
  };
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const sendPng = (
  response: ServerResponse,
  body: Buffer,
  headers: Record<string, string> = {}
): void => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "image/png",
    ...headers
  });
  response.end(body);
};
