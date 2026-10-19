// apps/admin-portal/lib/api-client.ts

// Địa chỉ URL của Backend API (Cấu hình qua môi trường hoặc mặc định localhost)
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { params, headers, ...customConfig } = options;

  // Tạo URL hoàn chỉnh với query parameters nếu có
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (params) {
    Object.keys(params).forEach((key) =>
      url.searchParams.append(key, params[key]),
    );
  }

  // Lấy token xác thực từ localStorage (nếu có)
  const token =
    typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const config: RequestInit = {
    method: options.method || "GET",
    headers: defaultHeaders,
    ...customConfig,
  };

  try {
    const response = await fetch(url.toString(), config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Lỗi yêu cầu API: ${response.status}`,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
}
