import { Suspense } from "react";
import StudentLearning from "../../../StudentLearning";

async function Detail({ params }: PageProps<"/student/hoc-lieu/[code]/[lesson]">) {
  const { code, lesson } = await params;
  return <StudentLearning code={code} lessonId={lesson} />;
}

export default function Page(props: PageProps<"/student/hoc-lieu/[code]/[lesson]">) {
  return <Suspense fallback={<p role="status">Đang tải…</p>}><Detail {...props} /></Suspense>;
}
