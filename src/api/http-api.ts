import type { Server } from "node:http";
import { createServer } from "node:http";

import type { BlipWatchConfig } from "../config/config.js";
import type { Logger } from "../logging/logger.js";
import type { RadarImageRenderer } from "../radar/renderer.js";
import type { ReplayBuffer } from "../replay/replay-buffer.js";

export interface HttpApi {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface HttpApiOptions {
  readonly config: BlipWatchConfig;
  readonly logger: Logger;
  readonly renderer: RadarImageRenderer;
  readonly replayBuffer: ReplayBuffer;
}

export const createHttpApi = ({ config, logger }: HttpApiOptions): HttpApi => {
  let server: Server | undefined;

  return {
    async start(): Promise<void> {
      server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, service: "blipwatch" }));
      });

      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(config.port, () => {
          logger.info(`HTTP API listening on :${config.port}`);
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
      server = undefined;
    }
  };
};
