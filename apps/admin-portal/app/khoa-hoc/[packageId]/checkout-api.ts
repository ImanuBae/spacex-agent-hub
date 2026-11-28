import { OperationError } from "../../../lib/services/classes";

export type Attempt = { key: string; id: string; classId: string; submitted: boolean };
export type Preview = {
  id: string; courseName: string; className: string; classCode: string; packageName: string; amountDue: number;
  expiresAt: string; terms: string; coursePolicy: string; packagePolicy: string; registrationConsent: string; courseNoticesConsent: string;
};

export async function checkoutRequest<T>(path: string, key: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    headers: { "content-type": "application/json", "x-checkout-key": key }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new OperationError(json.error?.message ?? "Dịch vụ đang gián đoạn. Vui lòng thử lại.", json.error?.code, json.error?.details);
  return json.data as T;
}
export const checkoutApi = "/api/v1/public-checkouts";

