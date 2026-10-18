import { expect, it } from "vitest";
import { TokenClaims } from "./auth.js";
import { CourseInput, CoursePackageInput, ListQuery } from "./catalog.js";

const course = { code: "OFFICE", name: "Tin học văn phòng", goal: "Sử dụng Office",
  level: "beginner", deliveryModes: ["onsite"], priceVnd: 1500000 };
it("accepts a center-wide course price and defaults draft status", () => {
  expect(CourseInput.parse(course).status).toBe("draft");
});
it("rejects negative/fractional prices and uncontracted branch prices", () => {
  expect(CourseInput.safeParse({ ...course, priceVnd: -1 }).success).toBe(false);
  expect(CourseInput.safeParse({ ...course, priceVnd: 1.5 }).success).toBe(false);
  expect(CourseInput.safeParse({ ...course, branchPrices: {} }).success).toBe(false);
});
it("requires a package to reference a course and have positive session count", () => {
  expect(CoursePackageInput.safeParse({ code: "A", name: "A", sessionCount: 0, priceVnd: 1 }).success).toBe(false);
});
it("limits list size", () => {
  expect(ListQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
  expect(ListQuery.safeParse({ pageSize: 1000 }).success).toBe(false);
});
it("supports branch lists and rejects obsolete role names", () => {
  expect(TokenClaims.safeParse({ sub: "user-1", role: "branch_director",
    branchIds: ["b428c292-02e9-480d-9813-51cb7d5b5885"], exp: 2000000000 }).success).toBe(true);
  expect(TokenClaims.safeParse({ sub: "user-1", role: "admin", branchIds: [], exp: 2000000000 }).success).toBe(false);
});
