import type { LogSink } from "../../src/logging/logger.js";

export const createMemorySink = (): { readonly messages: string[]; readonly sink: LogSink } => {
  const messages: string[] = [];
  const sink: LogSink = {
    debug(message: string): void {
      messages.push(message);
    },
    error(message: string): void {
      messages.push(message);
    },
    info(message: string): void {
      messages.push(message);
    },
    warn(message: string): void {
      messages.push(message);
    }
  };

  return { messages, sink };
};
