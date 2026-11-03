import { api, allPages } from "./classes";
export { api, allPages };
export type { PersonView, ConsentView, RelationshipView, LeadView, ErasureView, ErasureTaskView } from "@spacex/contracts";
export type Assignee = { id: string; name: string; role: string };
export const kinds = { CONTACT: "Người liên hệ", LEARNER: "Học viên", PAYER: "Người trả tiền" };
export const stages = { NEW: "Mới tiếp nhận", CONTACTED: "Đang tư vấn", QUALIFIED: "Đủ nhu cầu", LOST: "Đã đóng" };
export const sources = { WALK_IN: "Tại quầy", PHONE: "Điện thoại", WEB_CHAT: "Web chat", REFERRAL: "Giới thiệu", FACEBOOK: "Facebook", ZALO: "Zalo", OTHER: "Khác" };
export const purposes = { ADMISSIONS: "Tư vấn tuyển sinh", MARKETING: "Marketing", COURSE_NOTICES: "Thông báo khóa học" };
export const erasureStates = { PENDING_VERIFICATION: "Chờ xác minh", VERIFIED: "Đã xác minh", PROCESSING: "Đang xử lý", COMPLETED: "Hoàn tất", REJECTED: "Từ chối" };
export const services = { CRM: "Hồ sơ CRM", CONVERSATION: "Hội thoại", ENROLLMENT: "Đăng ký học", PAYMENT: "Thanh toán", REPORTING: "Báo cáo / xuất dữ liệu", BACKUPS: "Bản sao lưu" };
export function intentKey(ref: { current: { payload: string; key: string } | null }, payload: unknown) {
  const text = JSON.stringify(payload);
  if (ref.current?.payload !== text) ref.current = { payload: text, key: crypto.randomUUID() };
  return ref.current.key;
}
