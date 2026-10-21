export type CourseLevel = "beginner" | "intermediate" | "advanced";
export type CourseStatus = "draft" | "active" | "closed";
export type CourseDeliveryMode = "onsite" | "online";

export interface CourseInput {
  code: string;
  name: string;
  description: string;
  goal: string;
  level: CourseLevel;
  deliveryModes: CourseDeliveryMode[];
  branchIds: string[];
  priceVnd: number;
  status: CourseStatus;
}

export interface Course extends CourseInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

interface ApiEnvelope<T> {
  data: T;
}

export class CourseApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "CourseApiError";
    this.code = code;
    this.details = details;
  }
}

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4001"
).replace(/\/$/, "");
const COURSES_URL = `${API_BASE_URL}/api/v1/courses`;

function formatDetails(details: unknown): string {
  if (!Array.isArray(details)) {
    return details === undefined ? "" : JSON.stringify(details);
  }

  return details
    .map((detail: unknown) => {
      if (typeof detail !== "object" || detail === null) {
        return String(detail);
      }

      const item = detail as { path?: unknown; message?: unknown };
      const path = typeof item.path === "string" ? `${item.path}: ` : "";
      return `${path}${typeof item.message === "string" ? item.message : JSON.stringify(detail)}`;
    })
    .join("; ");
}

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(
      `Không thể kết nối Catalog API tại ${API_BASE_URL}. Hãy kiểm tra Catalog Backend và cấu hình CORS.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Catalog API trả về phản hồi không hợp lệ (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    const errorBody =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error?: ApiErrorBody }).error
        : undefined;
    const message =
      typeof errorBody?.message === "string"
        ? errorBody.message
        : `Yêu cầu Catalog API thất bại (HTTP ${response.status}).`;
    const details = errorBody?.details;
    const formattedDetails = formatDetails(details);
    throw new CourseApiError(
      formattedDetails ? `${message}: ${formattedDetails}` : message,
      errorBody?.code,
      details,
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body)
  ) {
    throw new Error("Phản hồi Catalog API không có trường data.");
  }

  return body as ApiEnvelope<T>;
}

export const courseService = {
  getAllCourses: async (): Promise<Course[]> => {
    const { data } = await request<Course[]>(
      `${COURSES_URL}?page=1&pageSize=100`,
    );
    return data;
  },

  createCourse: async (data: CourseInput): Promise<Course> => {
    const response = await request<Course>(COURSES_URL, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  updateCourse: async (id: string, data: CourseInput): Promise<Course> => {
    const response = await request<Course>(
      `${COURSES_URL}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return response.data;
  },

  deleteCourse: async (id: string): Promise<{ success: boolean }> => {
    const response = await request<{ success: boolean }>(
      `${COURSES_URL}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return response.data;
  },
};
