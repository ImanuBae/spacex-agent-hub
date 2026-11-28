import { z } from "zod";

const optionalText = (max: number, message: string) => z.string().trim().max(max, message).default("");

export const SelfRegistrationPerson = z.object({
  fullName: z.string().trim().min(1, "Nhập họ và tên.").max(120, "Họ và tên tối đa 120 ký tự."),
  email: z.string().trim().toLowerCase().pipe(z.email("Nhập email hợp lệ.").max(254)),
  phone: z.string().trim().max(30, "Nhập số điện thoại hợp lệ.")
    .refine(value => /^\+?[\d ().-]+$/.test(value) && /^\d{8,15}$/.test(value.replace(/\D/g, "")), "Nhập số điện thoại hợp lệ."),
  birthYear: z.string().trim().refine(value => !value || /^\d{4}$/.test(value) && Number(value) >= 1900 && Number(value) <= new Date().getUTCFullYear(), "Nhập năm sinh hợp lệ.").default(""),
  address: optionalText(300, "Địa chỉ tối đa 300 ký tự."),
  notes: optionalText(1000, "Ghi chú tối đa 1000 ký tự."),
}).strict();

export const CourseNoticesConsent = "Tôi đăng ký cho bản thân và đồng ý nhận thông báo về đăng ký và lịch học qua email và cổng học viên.";
export const RegistrationConsent = "Tôi đồng ý sử dụng thông tin đã nhập để xử lý đăng ký học.";
export const SelfRegistrationBrowserProof = z.object({ checkoutId: z.uuid(), browserKey: z.uuidv4() });

export const LearnerMembership = z.object({ learnerId: z.uuid(), branchId: z.uuid() });
export const LearnerMemberships = LearnerMembership.extend({ accountId: z.uuid(), memberships: z.array(LearnerMembership).min(1) });

export interface PublicOffer {
  packageId: string; packageCode: string; packageName: string;
  courseId: string; courseCode: string; courseName: string;
  goal: string; description: string; level: string; deliveryModes: string[];
  branchIds: string[]; priceVnd: number; sessionCount: number; sellable: boolean;
}

export interface PublicClass {
  id: string; branchId: string; courseId: string; packageId: string;
  code: string; name: string; mode: string; version: number;
  startsAt: string | null; sessionCount: number; availableSeats: number;
}
