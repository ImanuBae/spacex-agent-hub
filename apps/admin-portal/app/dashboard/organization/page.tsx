// apps/admin-portal/app/dashboard/organization/page.tsx
"use client";

import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import {
  organizationService,
  Department,
} from "../../../lib/services/organization";

export default function OrganizationPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(
    null,
  );
  const [deletingDepartmentId, setDeletingDepartmentId] = useState<
    number | null
  >(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    manager: "",
    memberCount: 1,
    description: "",
  });

  const loadDepartments = async () => {
    try {
      const data = await organizationService.getAllDepartments();
      setDepartments(data);
    } catch (error) {
      console.error("Lỗi tải danh sách phòng ban:", error);
      setErrorMessage(
        error instanceof Error
          ? `Không thể tải danh sách phòng ban: ${error.message}`
          : "Không thể tải danh sách phòng ban.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isActive = true;

    organizationService
      .getAllDepartments()
      .then((data) => {
        if (isActive) setDepartments(data);
      })
      .catch((error) => {
        console.error("Lỗi tải danh sách phòng ban:", error);
        if (isActive) {
          setErrorMessage(
            error instanceof Error
              ? `Không thể tải danh sách phòng ban: ${error.message}`
              : "Không thể tải danh sách phòng ban.",
          );
        }
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const openCreateModal = () => {
    setEditingDepartmentId(null);
    setFormData({ name: "", manager: "", memberCount: 1, description: "" });
    setErrorMessage("");
    setIsModalOpen(true);
  };

  const openEditModal = (department: Department) => {
    setEditingDepartmentId(department.id);
    setFormData({
      name: department.name,
      manager: department.manager,
      memberCount: department.memberCount,
      description: department.description,
    });
    setErrorMessage("");
    setIsModalOpen(true);
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = formData.name.trim();
    const manager = formData.manager.trim();
    if (!name || !manager) {
      alert("Vui lòng điền đầy đủ tên phòng ban và trưởng bộ phận!");
      return;
    }
    if (!Number.isInteger(formData.memberCount) || formData.memberCount < 1) {
      setErrorMessage("Số lượng nhân sự phải là số nguyên lớn hơn 0.");
      return;
    }

    try {
      setErrorMessage("");
      setIsSaving(true);
      const departmentData = {
        name,
        manager,
        memberCount: formData.memberCount,
        description: formData.description.trim(),
      };
      if (editingDepartmentId === null) {
        await organizationService.createDepartment(departmentData);
      } else {
        await organizationService.updateDepartment(
          editingDepartmentId,
          departmentData,
        );
      }
      setFormData({ name: "", manager: "", memberCount: 1, description: "" });
      setEditingDepartmentId(null);
      setIsModalOpen(false);
      await loadDepartments();
    } catch (error) {
      console.error(
        editingDepartmentId === null
          ? "Lỗi tạo phòng ban:"
          : "Lỗi cập nhật phòng ban:",
        error,
      );
      setErrorMessage(
        error instanceof Error
          ? `Không thể ${editingDepartmentId === null ? "tạo" : "cập nhật"} phòng ban: ${error.message}`
          : `Không thể ${editingDepartmentId === null ? "tạo" : "cập nhật"} phòng ban.`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Bạn có chắc chắn muốn xóa phòng ban này?")) {
      try {
        setErrorMessage("");
        setDeletingDepartmentId(id);
        await organizationService.deleteDepartment(id);
        await loadDepartments();
      } catch (error) {
        console.error("Lỗi xóa phòng ban:", error);
        setErrorMessage(
          error instanceof Error
            ? `Không thể xóa phòng ban: ${error.message}`
            : "Không thể xóa phòng ban.",
        );
      } finally {
        setDeletingDepartmentId(null);
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Tiêu đề trang & Nút thêm mới */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Quản lý Tổ chức & Phòng ban
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Quản lý cơ cấu phòng ban, đội ngũ nhân sự và phân bổ công việc trong
            trung tâm.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition cursor-pointer"
        >
          + Thêm phòng ban
        </button>
      </section>

      {errorMessage && !isModalOpen && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      )}

      {/* Danh sách phòng ban dạng lưới thẻ (Grid) */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
        {isLoading ? (
          <p className="col-span-2 text-center text-slate-400 italic py-16">
            Đang tải dữ liệu tổ chức...
          </p>
        ) : departments.length === 0 ? (
          <p className="col-span-2 text-center text-slate-400 italic py-16">
            Chưa có thông tin phòng ban nào.
          </p>
        ) : (
          departments.map((dept) => (
            <div
              key={dept.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between space-y-4 hover:shadow-md transition"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-800">
                    {dept.name}
                  </h3>
                  <span className="text-xs bg-blue-50 text-blue-700 px-3 py-1 rounded-full font-semibold">
                    {dept.memberCount} nhân sự
                  </span>
                </div>
                <p className="text-sm text-slate-600">{dept.description}</p>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-sm">
                <span className="text-slate-500">
                  Trưởng bộ phận:{" "}
                  <strong className="text-slate-700">{dept.manager}</strong>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(dept)}
                    disabled={deletingDepartmentId !== null || isSaving}
                    className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-semibold rounded-lg hover:bg-blue-100 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(dept.id)}
                    disabled={deletingDepartmentId !== null || isSaving}
                    className="px-3 py-1 bg-red-50 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-100 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingDepartmentId === dept.id ? "Đang xóa..." : "Xóa"}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Modal thêm mới phòng ban */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-slate-800">
                {editingDepartmentId === null
                  ? "Thêm phòng ban mới"
                  : "Chỉnh sửa phòng ban"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setErrorMessage("");
                }}
                disabled={isSaving}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                &times;
              </button>
            </div>

            {errorMessage && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {errorMessage}
              </p>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Tên phòng ban
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Phòng Truyền thông"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Trưởng bộ phận
                </label>
                <input
                  type="text"
                  required
                  placeholder="Họ tên quản lý"
                  value={formData.manager}
                  onChange={(e) =>
                    setFormData({ ...formData, manager: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Số lượng nhân sự
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.memberCount}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      memberCount: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Mô tả chức năng
                </label>
                <textarea
                  rows={3}
                  placeholder="Mô tả ngắn gọn nhiệm vụ phòng ban..."
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setErrorMessage("");
                  }}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving
                    ? "Đang lưu..."
                    : editingDepartmentId === null
                      ? "Thêm phòng ban"
                      : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
