import { Suspense } from "react";
import StudentLearning from "../../StudentLearning";

async function Detail({ params }: PageProps<"/student/hoc-lieu/[code]">) {
  const { code } = await params;
  return <StudentLearning code={code} />;
}

export default function Page(props: PageProps<"/student/hoc-lieu/[code]">) {
  return <Suspense fallback={<p role="status">Đang tải…</p>}><Detail {...props} /></Suspense>;
}
