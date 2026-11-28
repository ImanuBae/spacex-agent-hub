import type { Metadata } from "next";
import { Suspense } from "react";
import CoursesView from "./CoursesView";
import CourseLoading from "./CourseLoading";

export const metadata: Metadata = {
  title: "Khóa học & gói học | SpaceX Agent Hub",
  description: "Khám phá học phí, nội dung và lớp đang mở đăng ký tại SpaceX Agent Hub.",
};

export default function CoursesPage() {
  return <Suspense fallback={<CourseLoading>Đang tải danh mục khóa học…</CourseLoading>}><CoursesView /></Suspense>;
}
