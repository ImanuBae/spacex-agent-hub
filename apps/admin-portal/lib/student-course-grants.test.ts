import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/student-library/route";
import { authenticatedFetch, gatewayFetch } from "./server-session";

vi.mock("./server-session", () => ({
  authenticatedFetch: vi.fn(),
  gatewayFetch: vi.fn(),
  checkOrigin: (request: Request) => request.headers.get("origin") === new URL(request.url).origin,
  apiError: (status: number) => new Response(null, { status }),
}));

const student = { id: "student-one", role: "student", active: true };
const session = (account = student, enrollments: unknown[] = []) => vi.mocked(authenticatedFetch).mockImplementation(async path =>
  Response.json({ data: path === "/api/v1/auth/me" ? account : enrollments }));
const request = (query = "") => new Request("https://portal.test/api/student-library" + query);

describe("student library access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("STUDENT_COURSE_GRANTS", JSON.stringify({ "student-one": ["PYTHON", "SQL", "UNPUBLISHED"] }));
    vi.stubEnv("STUDENT_PRACTICE_SCHEDULES", "{}");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns each granted public course once with its published metadata", async () => {
    session();
    vi.mocked(gatewayFetch).mockResolvedValue(Response.json({ data: [
      { packageId: "one", courseCode: "PYTHON", courseName: "Python cơ bản", sellable: true },
      { packageId: "two", courseCode: "PYTHON", sellable: true },
      { packageId: "three", courseCode: "SQL", sellable: true },
      { packageId: "four", courseCode: "UNPUBLISHED", sellable: false },
      { packageId: "five", courseCode: "OTHER", sellable: true },
    ] }));
    const response = await GET(request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: [
      { packageId: "one", courseCode: "PYTHON", courseName: "Python cơ bản", lessonIds: [] },
      { packageId: "three", courseCode: "SQL", lessonIds: [] },
    ] });
  });

  it("shows no grants to a different learner", async () => {
    session({ ...student, id: "student-two" });
    expect(await (await GET(request())).json()).toEqual({ data: [] });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("requires a live student session", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    session({ ...student, role: "center_director" });
    expect((await GET(request())).status).toBe(403);
    session({ ...student, active: false });
    expect((await GET(request())).status).toBe(403);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("fails closed if the grants are malformed", async () => {
    session();
    vi.stubEnv("STUDENT_COURSE_GRANTS", "{");
    expect((await GET(request())).status).toBe(503);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("returns lesson content only for a grant belonging to the current student", async () => {
    vi.stubEnv("STUDENT_COURSE_GRANTS", JSON.stringify({ "student-one": ["DEMO-PYTHON"] }));
    session();
    vi.mocked(gatewayFetch).mockResolvedValue(Response.json({ data: [
      { packageId: "one", courseCode: "DEMO-PYTHON", sellable: true },
      { packageId: "two", courseCode: "DEMO-SQL", sellable: true },
    ] }));
    const response = await GET(request("?course=DEMO-PYTHON"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data.lessons).toHaveLength(3);
    expect(data.lessons[0].video.embed).toMatch(/^https:\/\/video\.cs50\.io\//);
    expect(data.quiz).toHaveLength(3);
    expect(Object.keys(data.quiz[0]).sort()).toEqual(["choices", "prompt"]);
    session();
    vi.mocked(gatewayFetch).mockResolvedValue(Response.json({ data: [
      { packageId: "two", courseCode: "DEMO-SQL", sellable: true },
    ] }));
    expect((await GET(request("?course=DEMO-SQL"))).status).toBe(403);
  });

  it("opens materials for active purchases after delisting and omits expired entitlements", async () => {
    session({ ...student, id: "student-two" }, [
      { currentEntitlement: { packageId: "one", state: "ACTIVE" }, snapshot: {} },
      { currentEntitlement: { packageId: "two", state: "ACTIVE", expiresAt: "2000-01-01T00:00:00Z" }, snapshot: {} },
    ]);
    vi.mocked(gatewayFetch).mockImplementation(async path => Response.json({ data: path.endsWith("/one")
      ? { packageId: "one", courseCode: "DEMO-PYTHON", sellable: false }
      : [{ packageId: "two", courseCode: "DEMO-SQL", sellable: true }] }));
    expect((await GET(request("?course=DEMO-PYTHON"))).status).toBe(200);
    expect((await GET(request("?course=DEMO-SQL"))).status).toBe(403);
  });

  it("returns the practice calendar only for the configured account with the grant", async () => {
    const practice = [{ startsAt: "2026-12-11T12:00:00.000Z", endsAt: "2026-12-11T13:30:00.000Z" }];
    vi.stubEnv("STUDENT_COURSE_GRANTS", JSON.stringify({ "student-one": ["DEMO-PYTHON"], "student-two": ["DEMO-PYTHON"] }));
    vi.stubEnv("STUDENT_PRACTICE_SCHEDULES", JSON.stringify({ "student-one": { "DEMO-PYTHON": practice } }));
    vi.mocked(gatewayFetch).mockImplementation(async () => Response.json({ data: [
      { packageId: "one", courseCode: "DEMO-PYTHON", sellable: true },
    ] }));
    session();
    expect((await (await GET(request())).json()).data[0].practiceSessions).toEqual(practice);
    session({ ...student, id: "student-two" });
    expect((await (await GET(request())).json()).data[0].practiceSessions).toBeUndefined();
  });

  it("grades valid practice submissions after checking origin and course access", async () => {
    vi.stubEnv("STUDENT_COURSE_GRANTS", JSON.stringify({ "student-one": ["DEMO-PYTHON"] }));
    vi.mocked(gatewayFetch).mockImplementation(async () => Response.json({ data: [
      { packageId: "one", courseCode: "DEMO-PYTHON", sellable: true },
    ] }));
    const submit = (answers: number[], origin = "https://portal.test") =>
      new Request("https://portal.test/api/student-library?course=DEMO-PYTHON", {
        method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(answers),
      });
    session();
    expect((await POST(submit([1, 2, 0], "https://elsewhere.test"))).status).toBe(403);
    expect((await POST(submit([1, 9, 0]))).status).toBe(400);
    expect((await (await POST(submit([1, 0, 0]))).json()).data.score).toBe(2);
    session({ ...student, id: "student-two" });
    expect((await POST(submit([1, 2, 0]))).status).toBe(403);
  });
});
