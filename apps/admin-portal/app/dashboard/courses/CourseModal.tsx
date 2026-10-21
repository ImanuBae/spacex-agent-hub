"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type {
  Course,
  CourseDeliveryMode,
  CourseInput,
} from "../../../lib/services/courses";

interface CourseModalProps {
  onClose: () => void;
  onSubmit: (data: CourseInput) => Promise<void>;
  initialData?: Course | null;
}

export default function CourseModal({
  onClose,
  onSubmit,
  initialData,
}: CourseModalProps) {
  const [code, setCode] = useState(initialData?.code ?? "");
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [goal, setGoal] = useState(initialData?.goal ?? "");
  const [level, setLevel] = useState<Course["level"]>(
    initialData?.level ?? "beginner",
  );
  const [deliveryModes, setDeliveryModes] = useState<CourseDeliveryMode[]>(
    initialData?.deliveryModes ?? ["online"],
  );
  const [priceVnd, setPriceVnd] = useState(
    initialData?.priceVnd !== undefined ? initialData.priceVnd.toString() : "",
  );
  const [status, setStatus] = useState<Course["status"]>(
    initialData?.status ?? "draft",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const toggleDeliveryMode = (mode: CourseDeliveryMode, checked: boolean) => {
    setDeliveryModes((current) =>
      checked
        ? [...current, mode]
        : current.filter((deliveryMode) => deliveryMode !== mode),
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        code,
        name,
        description,
        goal,
        level,
        deliveryModes,
        branchIds: initialData?.branchIds ?? [],
        priceVnd: priceVnd.trim() ? Number(priceVnd) : Number.NaN,
        status,
      });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-xs">
      <div className="my-auto w-full max-w-lg space-y-6 rounded-2xl bg-white p-6 shadow-xl">
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
          <div
            role="alert"
            className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            Lưu khóa học thất bại: {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="course-code"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Mã khóa học
              </label>
              <input
                id="course-code"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="VD: PROG-01"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm"
              >
                <option value="draft">Draft (Bản nháp)</option>
                <option value="active">Active (Hoạt động)</option>
                <option value="closed">Closed (Đóng)</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="course-name"
              className="mb-1 block text-xs font-semibold uppercase text-slate-600"
            >
              Tên khóa học
            </label>
            <input
              id="course-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="VD: Lập trình JavaScript"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="course-level"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Cấp độ
              </label>
              <select
                id="course-level"
                value={level}
                onChange={(event) =>
                  setLevel(event.target.value as Course["level"])
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="course-price"
                className="mb-1 block text-xs font-semibold uppercase text-slate-600"
              >
                Học phí (VNĐ)
              </label>
              <input
                id="course-price"
                type="number"
                step="any"
                value={priceVnd}
                onChange={(event) => setPriceVnd(event.target.value)}
                placeholder="VD: 1500000"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="course-goal"
              className="mb-1 block text-xs font-semibold uppercase text-slate-600"
            >
              Mục tiêu khóa học
            </label>
            <textarea
              id="course-goal"
              rows={2}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
            />
          </div>

          <fieldset>
            <legend className="mb-2 block text-xs font-semibold uppercase text-slate-600">
              Hình thức học
            </legend>
            <div className="flex gap-5 text-sm text-slate-700">
              {(["onsite", "online"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={deliveryModes.includes(mode)}
                    onChange={(event) =>
                      toggleDeliveryMode(mode, event.target.checked)
                    }
                    className="rounded border-slate-300"
                  />
                  {mode === "onsite" ? "Tại trung tâm" : "Trực tuyến"}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="course-description"
              className="mb-1 block text-xs font-semibold uppercase text-slate-600"
            >
              Mô tả
            </label>
            <textarea
              id="course-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
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
