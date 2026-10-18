import { expect, it } from "vitest";
import { loadConfig } from "./index.js";

it("uses safe local defaults and parses ports", () => {
  expect(loadConfig({ PORT: "4100" })).toMatchObject({ PORT: 4100, HOST: "127.0.0.1" });
});
it("fails fast on invalid configuration", () => {
  expect(() => loadConfig({ PORT: "not-a-port" })).toThrow();
  expect(() => loadConfig({ PORT: "65536" })).toThrow();
});
