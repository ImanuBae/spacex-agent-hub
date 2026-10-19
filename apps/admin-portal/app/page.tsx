import { redirect } from "next/navigation";

export default function Home() {
  // Khi người dùng truy cập vào domain.com/, tự động chuyển hướng sang trang login hoặc dashboard
  redirect("/login");
}
