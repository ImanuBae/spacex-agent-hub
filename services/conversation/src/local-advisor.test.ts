import { afterEach, expect, it, vi } from "vitest";
import { createLocalAdvisor } from "./local-advisor.js";

const offer = {
  courseId: "python", courseName: "Lập trình Python", goal: "Học Python cơ bản",
  description: "Biến, vòng lặp và hàm", packageId: "9fe132f8-6efa-4879-9f62-ec44ddf9d385",
  packageName: "Gói cơ bản", branchIds: [], sellable: true, priceVnd: 1800000, sessionCount: 12,
};
const reply = createLocalAdvisor("qwen3:1.7b", "http://catalog.local", "http://classes.local");
const signal = new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

it("renders the selected course, fee and available classes from public data", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [offer] }))
    .mockResolvedValueOnce(Response.json({ message: { content: '{"course":0}' } }))
    .mockResolvedValueOnce(Response.json({ data: [
      { branchId: "branch", name: "PY01", startsAt: "2027-01-01T08:00:00Z", availableSeats: 3 },
      { branchId: "other", name: "PY02", startsAt: "2027-01-01T08:00:00Z", availableSeats: 1 },
    ] }));
  vi.stubGlobal("fetch", fetch);
  const result = await reply(["gói học python và lịch lớp"], "branch", signal);
  expect(result).toMatchObject({
    text: expect.stringMatching(/Gói cơ bản: 12 buổi, 1\.800\.000 ₫.[\s\S]*PY01:.*còn 3 chỗ/),
    sources: [{ api: "catalog.packages", offers: [{ packageId: offer.packageId, name: offer.packageName }] }, { api: "classes.list" }].map(source => expect.objectContaining(source)),
  });
  expect(JSON.stringify(result)).not.toContain("PY02");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "http://catalog.local/api/v1/public-offers", "http://127.0.0.1:11434/api/chat", `http://classes.local/public/classes/${offer.packageId}`,
  ]);
});

it("requests a handoff when Ollama returns an invalid course selection", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [offer] }))
    .mockResolvedValueOnce(Response.json({ message: { content: '{"course":42}' } })));
  await expect(reply(["gói học python"], "branch", signal)).resolves.toEqual({ errorCode: "MODEL_ERROR" });
});
