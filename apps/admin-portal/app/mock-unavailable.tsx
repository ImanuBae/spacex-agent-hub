export default function MockUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="max-w-lg space-y-3 rounded-xl bg-white p-6 text-slate-800">
        <h1 className="text-xl font-bold">Portal demo chưa được bật</h1>
        <p>Đăng nhập thật đang được phát triển. Bản demo chỉ dùng trong môi trường phát triển với chế độ mock được bật.</p>
      </div>
    </main>
  );
}
