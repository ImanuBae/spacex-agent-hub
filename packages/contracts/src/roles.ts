import { z } from "zod";

export const Role = z.enum([
  "center_director", "branch_director", "admissions", "accountant",
  "teacher", "student", "ai_agent",
]);
export type Role = z.infer<typeof Role>;
