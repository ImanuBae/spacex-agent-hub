import { expect, it } from "vitest";
import { availableRefund } from "./adjustments.js";

it("charges, reverses and reserves money without making protected tuition refundable", () => {
  expect(availableRefund(130_000, 0, 0, 0, 100_000)).toBe(30_000);
  expect(availableRefund(130_000, 40_000, 40_000, 20_000, 100_000)).toBe(10_000);
  expect(availableRefund(130_000, 0, 0, 25_000, 0)).toBe(105_000);
  expect(availableRefund(90_000, 0, 0, 0, 100_000)).toBe(0);
});
