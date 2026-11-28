import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/student-library/route";
import { authenticatedFetch, gatewayFetch } from "./server-session";

vi.mock("./server-session", () => ({
  authenticatedFetch: vi.fn(),
  gatewayFetch: vi.fn(),
  apiError: (status: number) => new Response(null, { status }),
}));

const student = { id: "student-one", role: "student", active: true };
const session = (account = student) => vi.mocked(authenticatedFetch).mockResolvedValue(Response.json({ data: account }));

describe("student library access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("STUDENT_COURSE_GRANTS", JSON.stringify({ "student-one": ["PYTHON", "SQL", "UNPUBLISHED"] }));
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
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: [
      { packageId: "one", courseCode: "PYTHON", courseName: "Python cơ bản" },
      { packageId: "three", courseCode: "SQL" },
    ] });
  });

  it("shows no grants to a different learner", async () => {
    session({ ...student, id: "student-two" });
    expect(await (await GET()).json()).toEqual({ data: [] });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("requires a live student session", async () => {
    vi.mocked(authenticatedFetch).mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET()).status).toBe(401);
    session({ ...student, role: "center_director" });
    expect((await GET()).status).toBe(403);
    session({ ...student, active: false });
    expect((await GET()).status).toBe(403);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("fails closed if the grants are malformed", async () => {
    session();
    vi.stubEnv("STUDENT_COURSE_GRANTS", "{");
    expect((await GET()).status).toBe(503);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
