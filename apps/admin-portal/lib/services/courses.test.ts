import { afterEach, expect, it, vi } from "vitest";
import { courseService, CourseApiError } from "./courses";

afterEach(() => vi.unstubAllGlobals());

it("uses the same-origin Catalog rewrite and unwraps the list", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    data: [{ id: "course-1", name: "Office" }],
    pagination: { page: 1, pageSize: 100, total: 1 },
  }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await courseService.getAllCourses()).toEqual([{ id: "course-1", name: "Office" }]);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/courses?page=1&pageSize=100");
});

it("preserves field validation details from Catalog", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    error: { code: "VALIDATION_ERROR", message: "Invalid input", details: [
      { path: "priceVnd", message: "Must not be negative" },
    ] }, correlationId: "test-123",
  }, { status: 400 })));
  const result = courseService.getAllCourses();
  await expect(result).rejects.toBeInstanceOf(CourseApiError);
  await expect(result).rejects.toMatchObject({
    code: "VALIDATION_ERROR", message: "Invalid input: priceVnd: Must not be negative",
  });
});
