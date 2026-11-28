import { NextResponse } from "next/server";
import type { PublicOffer } from "@spacex/contracts";
import { apiError, authenticatedFetch, gatewayFetch } from "../../../lib/server-session";
import { grantedCourseCodes } from "../../../lib/student-course-grants";

export async function GET() {
  try {
    const session = await authenticatedFetch("/api/v1/auth/me");
    if (session.status === 401) return apiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập học viên.");
    if (!session.ok) throw new Error("Không tải được phiên học viên.");
    const { data: account } = await session.json();
    if (account.role !== "student" || !account.active) return apiError(403, "FORBIDDEN", "Thư viện dành cho học viên.");

    const grants = grantedCourseCodes(account, process.env.STUDENT_COURSE_GRANTS ?? "{}");
    const courses = new Map<string, Pick<PublicOffer, "packageId" | "courseCode" | "courseName" | "goal" | "description">>();
    if (grants.length) {
      const response = await gatewayFetch("/api/v1/public-offers");
      if (!response.ok) throw new Error("Không tải được danh mục.");
      const { data: offers } = await response.json() as { data: PublicOffer[] };
      for (const { packageId, courseCode, courseName, goal, description, sellable } of offers) {
        if (sellable && grants.includes(courseCode) && !courses.has(courseCode)) {
          courses.set(courseCode, { packageId, courseCode, courseName, goal, description });
        }
      }
    }
    return NextResponse.json({ data: [...courses.values()] }, { headers: { "cache-control": "no-store" } });
  } catch {
    return apiError(503, "STUDENT_LIBRARY_UNAVAILABLE", "Chưa tải được thư viện học viên.");
  }
}
