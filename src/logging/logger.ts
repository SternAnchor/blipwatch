import type { LogLevel } from "../config/config.js";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface LogSink {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly sink?: LogSink;
}

export const createLogger = ({ level, sink = console }: LoggerOptions): Logger => ({
  debug(message: string): void {
    if (level !== "debug") {
      return;
    }

    sink.debug(formatMessage("debug", message));
  },
  info(message: string): void {
    sink.info(formatMessage("info", message));
  },
  warn(message: string): void {
    sink.warn(formatMessage("warn", message));
  },
  error(message: string, error?: unknown): void {
    sink.error(formatMessage("error", message), error);
  }
});

const formatMessage = (level: "debug" | "error" | "info" | "warn", message: string): string => {
  const timestamp = new Date().toISOString();
  return JSON.stringify({ level, message, timestamp });
};
