import { Suspense } from "react";
import { notFound } from "next/navigation";
import { StudentOrderDetail } from "../../StudentOrders";

async function Detail({ params }: PageProps<"/student/don-hang/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <StudentOrderDetail id={id} />;
}

export default function Page(props: PageProps<"/student/don-hang/[id]">) {
  return <Suspense fallback={<p role="status">Đang tải…</p>}><Detail {...props} /></Suspense>;
}
