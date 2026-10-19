export interface AdminProfile {
  name: string;
  email: string;
  phone: string;
}

export const PROFILE_UPDATED_EVENT = "admin-profile-updated";

const DEFAULT_PROFILE: AdminProfile = {
  name: "Quản trị viên",
  email: "",
  phone: "",
};

const SERVER_PROFILE_SNAPSHOT = JSON.stringify(DEFAULT_PROFILE);

export function getAdminProfile(): AdminProfile {
  if (typeof window === "undefined") {
    return DEFAULT_PROFILE;
  }

  const email =
    localStorage.getItem("admin_profile_email") ||
    localStorage.getItem("admin_user_email") ||
    localStorage.getItem("admin_user_name") ||
    "";
  const name =
    localStorage.getItem("admin_profile_name") ||
    email.split("@")[0] ||
    "Quản trị viên";

  return {
    name,
    email,
    phone: localStorage.getItem("admin_profile_phone") || "",
  };
}

export function subscribeToAdminProfile(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(PROFILE_UPDATED_EVENT, onChange);
  return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onChange);
}

export function getAdminProfileSnapshot(): string {
  return JSON.stringify(getAdminProfile());
}

export function getServerAdminProfileSnapshot(): string {
  return SERVER_PROFILE_SNAPSHOT;
}

export function parseAdminProfileSnapshot(snapshot: string): AdminProfile {
  const profile: unknown = JSON.parse(snapshot);
  if (
    typeof profile !== "object" ||
    profile === null ||
    !("name" in profile) ||
    !("email" in profile) ||
    !("phone" in profile) ||
    typeof profile.name !== "string" ||
    typeof profile.email !== "string" ||
    typeof profile.phone !== "string"
  ) {
    throw new Error("Dữ liệu hồ sơ không hợp lệ.");
  }
  return { name: profile.name, email: profile.email, phone: profile.phone };
}

export function saveAdminProfile(profile: AdminProfile): void {
  localStorage.setItem("admin_profile_name", profile.name);
  localStorage.setItem("admin_profile_email", profile.email);
  localStorage.setItem("admin_profile_phone", profile.phone);
  localStorage.setItem("admin_user_email", profile.email);
}
