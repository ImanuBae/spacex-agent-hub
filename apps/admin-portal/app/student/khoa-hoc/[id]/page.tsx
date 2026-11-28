import { Suspense } from "react";
import { notFound } from "next/navigation";
import { StudentCourseDetail } from "../../StudentCourses";

async function Detail({ params }: PageProps<"/student/khoa-hoc/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <StudentCourseDetail id={id} />;
}

export default function Page(props: PageProps<"/student/khoa-hoc/[id]">) {
  return <Suspense fallback={<p role="status">Đang tải…</p>}><Detail {...props} /></Suspense>;
}
