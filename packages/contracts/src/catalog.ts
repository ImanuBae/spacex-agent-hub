import { z } from "zod";

export const CourseInput = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  goal: z.string().trim().min(1).max(500),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  deliveryModes: z.array(z.enum(["onsite", "online"])).min(1),
  branchIds: z.array(z.string().uuid()).default([]),
  priceVnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["draft", "active", "closed"]).default("draft"),
}).strict();
export type CourseInput = z.infer<typeof CourseInput>;

// A package is an offer belonging to one course; its price is center-wide.
export const CoursePackageInput = z.object({
  courseId: z.string().uuid(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  sessionCount: z.number().int().positive(),
  priceVnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["draft", "active", "closed"]).default("draft"),
}).strict();
export type CoursePackageInput = z.infer<typeof CoursePackageInput>;

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
