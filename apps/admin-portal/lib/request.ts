export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("hub:unauthorized"));
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, response.status === 403 ? "Bạn không có quyền thực hiện thao tác này." : body.error?.message ?? `HTTP ${response.status}`);
  return body.data as T;
}
