"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Course } from "../../../lib/services/courses";

interface CourseModalProps {
  onClose: () => void;
  onSubmit: (data: Partial<Course>) => Promise<void>;
  initialData?: Course | null;
}

export default function CourseModal({
  onClose,
  onSubmit,
  initialData,
}: CourseModalProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [category, setCategory] = useState(initialData?.category ?? "");
  const [instructor, setInstructor] = useState(initialData?.instructor ?? "");
  const [price, setPrice] = useState(initialData?.price ?? "");
  const [status, setStatus] = useState<Course["status"]>(
    initialData?.status ?? "Đang mở",
  );
  const [image, setImage] = useState(initialData?.image ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({ title, category, instructor, price, status, image });
      onClose();
    } catch (error) {
      console.error("Lỗi khi lưu khóa học:", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Không thể lưu khóa học. Vui lòng thử lại.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg space-y-6 rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="text-lg font-bold text-slate-800">
            {initialData ? "Chỉnh sửa khóa học" : "Thêm khóa học mới"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng biểu mẫu"
            className="cursor-pointer font-semibold text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-red-600">
            Lưu khóa học thất bại: {submitError}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="course-title"
              className="mb-1 block text-xs font-semibold uppercase text-slate-600"
            >
              Tên khóa học
            </label>
            <input
              id="course-title"
              type="text"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="VD: Lập trình Next.js nâng cao"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="course-category"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Danh mục
              </label>
              <input
                id="course-category"
                type="text"
                required
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="VD: Công nghệ thông tin"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label
                htmlFor="course-instructor"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Giảng viên
              </label>
              <input
                id="course-instructor"
                type="text"
                required
                value={instructor}
                onChange={(event) => setInstructor(event.target.value)}
                placeholder="VD: Thầy Nguyễn Văn A"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="course-price"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Học phí
              </label>
              <input
                id="course-price"
                type="text"
                required
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="VD: 1.500.000 đ"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label
                htmlFor="course-status"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Trạng thái
              </label>
              <select
                id="course-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as Course["status"])
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="Đang mở">Đang mở</option>
                <option value="Sắp khai giảng">Sắp khai giảng</option>
                <option value="Đã kết thúc">Đã kết thúc</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="course-image"
              className="mb-1 block text-xs font-semibold uppercase text-slate-600"
            >
              Đường dẫn hình ảnh (URL)
            </label>
            <input
              id="course-image"
              type="url"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="cursor-pointer rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Đang lưu..." : "Lưu khóa học"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
