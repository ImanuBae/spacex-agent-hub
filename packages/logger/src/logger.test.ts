import { expect, it } from "vitest";
import { createLogger } from "./index.js";

it("preserves service identity and correlation in structured logs", () => {
  const lines: string[] = [];
  createLogger("catalog", line => lines.push(line)).info("event.received", {
    correlationId: "demo-123", service: "override-attempt",
  });
  expect(JSON.parse(lines[0])).toMatchObject({ service: "catalog", level: "info", correlationId: "demo-123" });
});
