export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const createLogger = (level: "debug" | "info"): Logger => ({
  debug(message: string): void {
    if (level === "debug") {
      console.debug(`[debug] ${message}`);
    }
  },
  info(message: string): void {
    console.info(`[info] ${message}`);
  },
  warn(message: string): void {
    console.warn(`[warn] ${message}`);
  },
  error(message: string, error?: unknown): void {
    console.error(`[error] ${message}`, error ?? "");
  }
});
