import type { ClassView, DemoFixture, HoldView } from "@spacex/contracts";
export type { ClassView, DemoFixture, HoldView };
export type Package = {
  id: string;
  courseId: string;
  code: string;
  name: string;
  sessionCount: number;
  priceVnd: number;
  status: "draft" | "active" | "closed";
  policyVersion: number;
  effectiveAt: string;
  policyText: string;
};
export type Branch = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
};
export type Teacher = {
  id: string;
  name: string;
  branchId: string;
  accountId: string;
};
export type Room = {
  id: string;
  name: string;
  branchId: string;
  capacity: number;
  active: boolean;
};
export class OperationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
export type Envelope<T> = {
  data: T;
  pagination?: { page: number; pageSize: number; total: number };
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new OperationError(
      "Không xác minh được kết quả do mất kết nối. Thử lại cùng yêu cầu.",
      "NETWORK_UNKNOWN",
    );
  }
  if (response.status === 401)
    window.dispatchEvent(new Event("hub:unauthorized"));
  const result = await response.json();
  if (!response.ok)
    throw new OperationError(
      response.status === 403
        ? `Bạn không có quyền: ${result.error?.message ?? "thao tác bị từ chối"}`
        : (result.error?.message ?? `Lỗi dịch vụ (${response.status})`),
      result.error?.code ?? "UNKNOWN",
      result.error?.details ?? [],
    );
  return result;
}
// Picker data loads every page rather than treating the first 100 rows as a complete catalog.
export async function allPages<T>(resource: string): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; ; page++) {
    const response = await api<T[]>(
      `${resource}${resource.includes("?") ? "&" : "?"}pageSize=100&page=${page}`,
    );
    result.push(...response.data);
    if (!response.pagination || result.length >= response.pagination.total)
      return result;
  }
}
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
export const money = (value: number) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
export const localTimeInput = (utc: string) =>
  new Date(new Date(utc).getTime() + 7 * 3600000).toISOString().slice(0, 16);
export const utcTime = (local: string) =>
  new Date(`${local}:00+07:00`).toISOString();
