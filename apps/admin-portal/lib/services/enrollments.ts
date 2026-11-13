export { api, allPages, dateTime, money } from "./classes";

export type EnrollmentSnapshot = {
  learnerId: string; contactId: string; payerId: string;
  classId: string; packageId: string; branchId: string;
  amountDue: number; currency: string; quoteId: string;
  quoteVersion: number; policyVersion: number; termsVersion: string; terms: string;
};
export type PaymentRequest = {
  id: string; status: string; amountDue: number; reference: string;
  expiresAt: string; qrPayload: string; adapter: string;
};
export type Enrollment = {
  id: string; confirmationId: string; status: string; version: number;
  snapshot: EnrollmentSnapshot; holdId?: string; expiresAt?: string;
  paymentRequest?: PaymentRequest; moneyStatus?: string; createdAt?: string;
};
export type EnrollmentConfirmation = {
  id: string; status: string; expiresAt: string;
  snapshot: EnrollmentSnapshot; enrollment?: Enrollment;
};
export const enrollmentStates: Record<string, string> = {
  PENDING_HOLD: "Đang yêu cầu giữ chỗ", HELD: "Đang giữ chỗ, chờ thanh toán",
  CONFIRMING: "Đã đối soát tiền, đang xác nhận chỗ", CONFIRMED: "Đã xác nhận chỗ học",
  PAYMENT_REVIEW: "Kế toán đang xem xét", EXPIRED: "Đã hết hạn giữ chỗ",
  CANCELLED: "Đã hủy đăng ký", REFUND_PENDING: "Đang chờ duyệt / thực hiện hoàn tiền",
  WAITLISTED: "Đang chờ lớp có chỗ", COMPLETED: "Đã hoàn tất khóa học",
};
export const confirmationStates: Record<string, string> = {
  DRAFT: "Chờ xác nhận điều khoản", CONFIRMED: "Đã ghi nhận xác nhận mua",
  REVOKED: "Đã rút xác nhận", EXPIRED: "Xác nhận đã hết hạn", CONSUMED: "Đã tiếp nhận xử lý đăng ký",
};
export const moneyStates: Record<string, string> = {
  UNPAID: "Chưa ghi nhận tiền", OPEN: "Chờ thanh toán", MATCHED: "Đã đối soát đủ tiền",
  SETTLED: "Đã đối soát đủ tiền", REVIEW: "Chờ kế toán đối soát", PARTIAL: "Đã nhận thiếu",
  OVERPAID: "Đã nhận thừa", UNALLOCATED: "Chưa phân bổ", REFUND_PENDING: "Đang chờ hoàn tiền",
};
