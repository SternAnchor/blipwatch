import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logging/logger.js";
import { createMemorySink } from "./support/logger.js";

describe("createLogger", () => {
  it("suppresses debug messages at info level", () => {
    const { messages, sink } = createMemorySink();
    const logger = createLogger({ level: "info", sink });

    logger.debug("hidden");
    logger.info("visible");

    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({ level: "info", message: "visible" });
  });

  it("emits debug messages at debug level", () => {
    const { messages, sink } = createMemorySink();
    const logger = createLogger({ level: "debug", sink });

    logger.debug("visible");

    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({ level: "debug", message: "visible" });
  });
});
