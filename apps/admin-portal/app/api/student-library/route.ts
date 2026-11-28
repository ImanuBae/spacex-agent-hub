import { NextResponse } from "next/server";
import type { PublicOffer } from "@spacex/contracts";
import { apiError, authenticatedFetch, checkOrigin, gatewayFetch } from "../../../lib/server-session";
import { grantedCourseCodes, practiceSessions } from "../../../lib/student-course-grants";
import { studentLessons, studentQuiz } from "../../../lib/student-lessons";
import type { Enrollment, LibraryCourse, StudentAccount } from "../../../lib/student-portal";

function result(data: unknown) {
  return NextResponse.json({ data }, { headers: { "cache-control": "no-store" } });
}

async function courseAccess(requested: string | null) {
  const session = await authenticatedFetch("/api/v1/auth/me");
  if (session.status === 401) return apiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập học viên.");
  if (!session.ok) throw new Error("Không tải được phiên học viên.");
  const { data: account } = await session.json() as { data: StudentAccount };
  if (account.role !== "student" || !account.active) return apiError(403, "FORBIDDEN", "Thư viện dành cho học viên.");

  const grants = new Set(grantedCourseCodes(account, process.env.STUDENT_COURSE_GRANTS ?? "{}"));
  const packages = new Set<string>();
  if (!requested || !grants.has(requested)) {
    const response = await authenticatedFetch("/api/v1/student/enrollments");
    if (response.status === 401) return apiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập học viên.");
    if (response.ok) {
      const { data: enrollments } = await response.json() as { data: Enrollment[] };
      for (const row of enrollments) {
        const entitlement = row.currentEntitlement;
        const packageId = entitlement.packageId ?? row.snapshot.packageId;
        if (packageId && entitlement.state === "ACTIVE" && (!entitlement.expiresAt || Date.parse(entitlement.expiresAt) > Date.now())) {
          packages.add(packageId);
        }
      }
    } else if (response.status >= 500 && (!grants.size || requested)) {
      throw new Error("Không tải được quyền học.");
    }
  }

  const courses = new Map<string, LibraryCourse>();
  if (grants.size || packages.size) {
    const response = await gatewayFetch("/api/v1/public-offers");
    if (!response.ok) throw new Error("Không tải được danh mục.");
    const { data: offers } = await response.json() as { data: PublicOffer[] };
    const visiblePackages = new Set(offers.map(offer => offer.packageId));
    const unlisted = await Promise.all([...packages].filter(id => !visiblePackages.has(id)).map(async id => {
      const detail = await gatewayFetch(`/api/v1/public-offers/${id}`);
      if (detail.status === 404) return [];
      if (!detail.ok) throw new Error("Không tải được gói học đã đăng ký.");
      const { data } = await detail.json() as { data: PublicOffer };
      return data.packageId === id ? [data] : [];
    }));
    const entitledOffers = [...offers.filter(offer => packages.has(offer.packageId)), ...unlisted.flat()];
    for (const { packageId, courseCode, courseName, goal, description, sellable } of [...entitledOffers, ...offers]) {
      if ((requested && courseCode !== requested) || courses.has(courseCode)) continue;
      const manuallyGranted = sellable && grants.has(courseCode);
      if (!manuallyGranted && !packages.has(packageId)) continue;
      const sessions = manuallyGranted && !packages.has(packageId)
        ? practiceSessions(process.env.STUDENT_PRACTICE_SCHEDULES ?? "{}", account.id, courseCode) : [];
      courses.set(courseCode, { packageId, courseCode, courseName, goal, description, ...(sessions.length ? { practiceSessions: sessions } : {}) });
    }
  }
  return courses;
}

const unavailable = () => apiError(503, "STUDENT_LIBRARY_UNAVAILABLE", "Chưa tải được học liệu. Vui lòng thử lại.");

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("course");
  try {
    const courses = await courseAccess(requested);
    if (courses instanceof Response) return courses;
    if (requested !== null) {
      const course = courses.get(requested);
      if (!course) return apiError(403, "COURSE_NOT_GRANTED", "Bạn chưa được cấp quyền vào học liệu này.");
      const lessons = studentLessons(requested)?.lessons ?? [];
      const quiz = studentQuiz(requested).map(({ prompt, choices }) => ({ prompt, choices }));
      return result({ ...course, lessonIds: lessons.map(lesson => lesson.id), lessons, ...(quiz.length ? { quiz } : {}) });
    }
    return result([...courses.values()].map(course => ({
      ...course, lessonIds: studentLessons(course.courseCode)?.lessons.map(lesson => lesson.id) ?? [],
    })));
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) return apiError(403, "FORBIDDEN", "Yêu cầu không hợp lệ.");
  const requested = new URL(request.url).searchParams.get("course");
  if (!requested) return apiError(400, "INVALID_QUIZ", "Chọn bài tự luyện.");
  try {
    const courses = await courseAccess(requested);
    if (courses instanceof Response) return courses;
    if (!courses.has(requested)) return apiError(403, "COURSE_NOT_GRANTED", "Bạn chưa được cấp quyền vào học liệu này.");
    const quiz = studentQuiz(requested);
    if (!quiz.length) return apiError(404, "QUIZ_NOT_FOUND", "Khóa học chưa có quiz tự luyện.");
    const input: unknown = await request.json().catch(() => null);
    if (!Array.isArray(input) || input.length !== quiz.length ||
      !input.every((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < quiz[index].choices.length)) {
      return apiError(400, "INVALID_ANSWERS", "Chọn một phương án cho mỗi câu.");
    }
    const feedback = quiz.map(({ answer, explanation }, index) => ({ correct: input[index] === answer, explanation }));
    return result({ score: feedback.filter(item => item.correct).length, feedback });
  } catch { return unavailable(); }
}
