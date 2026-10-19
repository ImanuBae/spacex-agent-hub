"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import {
  getAdminProfileSnapshot,
  getServerAdminProfileSnapshot,
  parseAdminProfileSnapshot,
  PROFILE_UPDATED_EVENT,
  saveAdminProfile,
  subscribeToAdminProfile,
  type AdminProfile,
} from "../../../lib/services/profile";

export default function ProfilePage() {
  const profileSnapshot = useSyncExternalStore(
    subscribeToAdminProfile,
    getAdminProfileSnapshot,
    getServerAdminProfileSnapshot,
  );
  const storedProfile = parseAdminProfileSnapshot(profileSnapshot);
  const [profileDraft, setProfileDraft] = useState<AdminProfile | null>(null);
  const profile = profileDraft ?? storedProfile;
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const updatedProfile = {
      ...profile,
      name: profile.name.trim(),
      email: profile.email.trim(),
      phone: profile.phone.trim(),
    };

    if (!updatedProfile.name || !updatedProfile.email) {
      setErrorMessage("Vui lòng nhập họ tên và địa chỉ email.");
      return;
    }

    try {
      saveAdminProfile(updatedProfile);
      setProfileDraft(updatedProfile);
      setErrorMessage("");
      setSuccessMessage("Thông tin cá nhân đã được cập nhật.");
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
    } catch (error) {
      console.error("Lỗi lưu thông tin cá nhân:", error);
      setSuccessMessage("");
      setErrorMessage("Không thể lưu thông tin cá nhân. Vui lòng thử lại.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">
          Trang cá nhân
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Cập nhật thông tin hồ sơ quản trị viên của bạn.
        </p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        {successMessage && (
          <p
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
          >
            {successMessage}
          </p>
        )}
        {errorMessage && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}

        <div>
          <label
            htmlFor="profile-name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Họ và tên
          </label>
          <input
            id="profile-name"
            type="text"
            required
            value={profile.name}
            onChange={(event) => {
              setProfileDraft({ ...profile, name: event.target.value });
              setSuccessMessage("");
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label
            htmlFor="profile-email"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Địa chỉ email
          </label>
          <input
            id="profile-email"
            type="email"
            required
            value={profile.email}
            onChange={(event) => {
              setProfileDraft({ ...profile, email: event.target.value });
              setSuccessMessage("");
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label
            htmlFor="profile-phone"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Số điện thoại
          </label>
          <input
            id="profile-phone"
            type="tel"
            value={profile.phone}
            onChange={(event) => {
              setProfileDraft({ ...profile, phone: event.target.value });
              setSuccessMessage("");
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Lưu thay đổi
          </button>
        </div>
      </form>
    </div>
  );
}
