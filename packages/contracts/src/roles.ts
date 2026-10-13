import { z } from "zod";

// Thay bằng danh sách vai trò thật ở mục 4.6 của product plan
export const Role = z.enum(["admin", "director", "admissions", "accountant", "teacher"]);
export type Role = z.infer<typeof Role>;