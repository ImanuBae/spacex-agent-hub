export interface AdminProfile {
  name: string;
  email: string;
  phone: string;
}

export const PROFILE_UPDATED_EVENT = "admin-profile-updated";

export function getAdminProfile(): AdminProfile {
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

export function saveAdminProfile(profile: AdminProfile): void {
  localStorage.setItem("admin_profile_name", profile.name);
  localStorage.setItem("admin_profile_email", profile.email);
  localStorage.setItem("admin_profile_phone", profile.phone);
  localStorage.setItem("admin_user_email", profile.email);
}
