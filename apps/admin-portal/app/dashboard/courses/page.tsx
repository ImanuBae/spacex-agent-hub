"use client";

import { useEffect, useState } from "react";
import CourseModal from "./CourseModal";
import { courseService } from "../../../lib/services/courses";
import type { Course, CourseInput } from "../../../lib/services/courses";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("vi-VN").format(value) + " đ";

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  useEffect(() => {
    let isMounted = true;

    courseService
      .getAllCourses()
      .then((data) => {
        if (isMounted) {
          setCourses(data);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Không thể tải danh sách khóa học.",
          );
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleFormSubmit = async (formData: CourseInput) => {
    if (selectedCourse) {
      const updatedCourse = await courseService.updateCourse(
        selectedCourse.id,
        formData,
      );
      setCourses((current) =>
        current.map((course) =>
          course.id === updatedCourse.id ? updatedCourse : course,
        ),
      );
    } else {
      const createdCourse = await courseService.createCourse(formData);
      setCourses((current) => [createdCourse, ...current]);
    }
    setLoadError(null);
  };

  const filteredCourses = courses.filter((course) => {
    const query = searchTerm.toLowerCase();
    return (
      course.name.toLowerCase().includes(query) ||
      course.code.toLowerCase().includes(query)
    );
  });

  const getStatusStyle = (status: Course["status"]) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-700";
      case "draft":
        return "bg-amber-100 text-amber-700";
      case "closed":
        return "bg-slate-100 text-slate-600";
      default:
        return "bg-slate-100 text-slate-600";
    }
  };

  return (
    <div className="mx-auto w-full space-y-6">
      {/* Top Banner / Header */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">
            Quản lý khóa học & Catalog
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Thêm mới, chỉnh sửa và theo dõi danh sách khóa học hệ thống.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectedCourse(null);
            setIsModalOpen(true);
          }}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          <span className="text-lg leading-none">+</span>
          Thêm khóa học mới
        </button>
      </section>

      {/* Search & Stats Bar */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-md">
          <input
            id="course-search"
            type="text"
            placeholder="Tìm kiếm theo tên hoặc mã khóa học..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-2.5 sm:min-w-44">
          <span className="text-sm text-slate-500">Tổng số khóa học</span>
          <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-bold text-blue-700">
            {filteredCourses.length}
          </span>
        </div>
      </section>

      {/* Main Table Section */}
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
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-4 px-4 w-[16%]">Mã khóa học</th>
                <th className="py-4 px-4 w-[20%]">Tên khóa học</th>
                <th className="py-4 px-4 w-[24%]">Mô tả</th>
                <th className="py-4 px-4 w-[12%]">Cấp độ</th>
                <th className="py-4 px-4 w-[14%]">Học phí</th>
                <th className="py-4 px-4 w-[10%]">Trạng thái</th>
                <th className="py-4 px-4 w-[10%] text-center">Thao tác</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-16 text-center text-slate-400 italic"
                  >
                    Đang tải danh sách khóa học từ Catalog API...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td
                    colSpan={7}
                    role="alert"
                    className="px-5 py-16 text-center text-red-600"
                  >
                    Không thể tải danh sách khóa học: {loadError}
                  </td>
                </tr>
              ) : filteredCourses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <p className="font-semibold text-slate-700">
                      {searchTerm
                        ? "Không tìm thấy khóa học phù hợp"
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
                    <td className="px-4 py-4 font-mono font-semibold text-slate-700 text-xs">
                      {course.code}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-800">
                      {course.name}
                    </td>
                    <td className="px-4 py-4 text-slate-500 text-xs">
                      <span className="line-clamp-2">
                        {course.description || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 capitalize text-slate-600">
                      {course.level}
                    </td>
                    <td className="px-4 py-4 font-semibold text-blue-600 whitespace-nowrap">
                      {formatCurrency(course.priceVnd)}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusStyle(course.status)}`}
                      >
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />
                        {course.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCourse(course);
                            setIsModalOpen(true);
                          }}
                          className="cursor-pointer rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-100"
                        >
                          Sửa
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
