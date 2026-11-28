"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicOffer } from "@spacex/contracts";
import PythonMaterials from "../../khoa-hoc/PythonMaterials";
import Brand from "../../landing/Brand";
import { inter } from "../../ui/fonts";
import "../../ui/theme.css";
import "../../dashboard/components/operations.css";
import "../student.css";

type Course = Pick<PublicOffer, "packageId" | "courseCode" | "courseName" | "goal" | "description">;

export default function StudentLibrary() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/student-library", { signal: controller.signal });
        if (response.status === 401) { router.replace("/student/login"); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message);
        if (!controller.signal.aborted) setCourses(body.data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error && failure.message
          ? failure.message : "Chưa tải được thư viện học viên.");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, router]);

  return <main className={`hub-theme ops student-workspace ${inter.className}`}>
    <header className="student-topbar"><Brand /><Link className="ops-link" href="/student">Hồ sơ học viên</Link></header>
    <div className="student-heading"><h1>Học liệu của bạn</h1></div>
    {!courses && !error && <p role="status">Đang tải học liệu…</p>}
    {error && <div role="alert" className="ops-error">{error} <button onClick={() => { setError(""); setAttempt(n => n + 1); }}>Thử lại</button></div>}
    {courses?.length === 0 && <p>Bạn chưa được cấp quyền học liệu.</p>}
    {courses?.map(course => <article className="ops-panel student-library-course" key={course.courseCode}>
      <h2>{course.courseName}</h2>
      {course.description && <p>{course.description}</p>}
      <p>{course.goal}</p>
      {course.courseCode === "DEMO-PYTHON" && <PythonMaterials heading="h3" />}
      {course.courseCode !== "DEMO-PYTHON" && <Link className="ops-link" href={`/khoa-hoc/${course.packageId}${course.courseCode === "DEMO-SQL" ? "#course-preview" : ""}`}>
        {course.courseCode === "DEMO-SQL" ? "Mở bài học thử" : "Xem nội dung khóa học"}
      </Link>}
    </article>)}
  </main>;
}
