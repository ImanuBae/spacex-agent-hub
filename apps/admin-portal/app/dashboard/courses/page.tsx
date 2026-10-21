// apps/admin-portal/app/dashboard/courses/page.tsx
"use client";

import { useState, useEffect } from "react";
import { courseService, Course } from "../../../lib/services/courses";
import CourseModal from "./CourseModal";

// Hàm định dạng tiền tệ: thêm dấu phân cách hàng nghìn và chữ "đ"
const formatCurrency = (value: string | number) => {
  if (!value && value !== 0) return "";
  const number =
    typeof value === "string" ? parseInt(value.replace(/\D/g, ""), 10) : value;
  if (isNaN(number)) return value;
  return new Intl.NumberFormat("vi-VN").format(number) + " đ";
};

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const loadCourses = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);

      // Giả lập độ trễ mạng 1 giây để kiểm chứng rõ trạng thái Loading trên giao diện
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const data = await courseService.getAllCourses();
      setCourses(data);
    } catch (error) {
      console.error("Lỗi khi tải danh sách khóa học:", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Không thể tải danh sách khóa học.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initFetch = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const data = await courseService.getAllCourses();
        if (isMounted) {
          setCourses(data);
        }
      } catch (error: unknown) {
        console.error("Lỗi khi tải danh sách khóa học:", error);
        if (isMounted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Không thể tải danh sách khóa học.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initFetch();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleFormSubmit = async (formData: Partial<Course>) => {
    if (selectedCourse) {
      await courseService.updateCourse(selectedCourse.id.toString(), formData);
    } else {
      await courseService.createCourse(formData);
    }
    await loadCourses();
  };

  const handleEdit = (course: Course) => {
    setSelectedCourse(course);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setSelectedCourse(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm(`Bạn có chắc chắn muốn xóa khóa học #${id}?`)) {
      try {
        await courseService.deleteCourse(id.toString());
        await loadCourses();
      } catch (error) {
        console.error(`Lỗi khi xóa khóa học #${id}:`, error);
        alert("Xóa khóa học thất bại. Vui lòng thử lại.");
      }
    }
  };

  const filteredCourses = courses.filter((course) =>
    course.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getStatusStyle = (status: Course["status"]) => {
    switch (status) {
      case "Đang mở":
        return "bg-green-100 text-green-700";
      case "Sắp khai giảng":
        return "bg-amber-100 text-amber-700";
      case "Đã kết thúc":
        return "bg-slate-100 text-slate-600";
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Quản lý khóa học
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Thêm mới, chỉnh sửa và theo dõi danh sách các khóa học trong hệ
            thống.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer"
        >
          <span className="text-lg leading-none">+</span>
          Thêm khóa học mới
        </button>
      </section>

      {/* Thanh tìm kiếm và thống kê */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-md">
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Tìm kiếm khóa học
          </label>
          <input
            type="text"
            placeholder="Nhập tên khóa học..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 sm:min-w-48">
          <span className="text-sm text-slate-500">Tổng số khóa học</span>
          <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700">
            {filteredCourses.length}
          </span>
        </div>
      </section>

      {/* Bảng danh sách khóa học */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            Danh sách khóa học
          </h2>
          <p className="text-sm text-slate-500">
            Hiển thị {filteredCourses.length} / {courses.length} khóa học
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-20 px-5 py-4">ID</th>
                <th className="w-32 px-5 py-4">Hình ảnh</th>
                <th className="w-[24%] px-5 py-4">Tên khóa học</th>
                <th className="w-[16%] px-5 py-4">Danh mục</th>
                <th className="w-[16%] px-5 py-4">Giảng viên</th>
                <th className="w-36 px-5 py-4">Học phí</th>
                <th className="w-40 px-5 py-4">Trạng thái</th>
                <th className="w-40 px-5 py-4 text-center">Thao tác</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Đang tải danh sách khóa học từ hệ thống...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td
                    colSpan={8}
                    role="alert"
                    className="px-5 py-16 text-center text-red-600"
                  >
                    Không thể tải danh sách khóa học: {loadError}
                  </td>
                </tr>
              ) : filteredCourses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <p className="font-semibold text-slate-700">
                      {searchTerm
                        ? "Không tìm thấy khóa học"
                        : "Chưa có khóa học nào"}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredCourses.map((course) => (
                  <tr
                    key={course.id}
                    className="transition-colors hover:bg-slate-50"
                  >
                    <td className="px-5 py-4 font-medium text-slate-500">
                      #{course.id}
                    </td>
                    <td className="px-5 py-4">
                      {course.image ? (
                        <img
                          src={course.image}
                          alt={course.title}
                          className="h-16 w-24 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">
                          Chưa có ảnh
                        </div>
                      )}
                    </td>
                    <td className="break-words px-5 py-4 font-semibold text-slate-800">
                      {course.title}
                    </td>
                    <td className="break-words px-5 py-4">{course.category}</td>
                    <td className="break-words px-5 py-4">
                      {course.instructor}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-semibold text-blue-600">
                      {formatCurrency(course.price)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${getStatusStyle(course.status)}`}
                      >
                        <span className="mr-2 h-1.5 w-1.5 rounded-full bg-current" />
                        {course.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(course)}
                          className="rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-100 cursor-pointer"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(course.id)}
                          className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 cursor-pointer"
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Thêm / Sửa Khóa Học */}
      {isModalOpen && (
        <CourseModal
          key={selectedCourse?.id ?? "new-course"}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleFormSubmit}
          initialData={selectedCourse}
        />
      )}
    </div>
  );
}
