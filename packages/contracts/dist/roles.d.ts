import { z } from "zod";
export declare const Role: z.ZodEnum<{
    admin: "admin";
    director: "director";
    admissions: "admissions";
    accountant: "accountant";
    teacher: "teacher";
}>;
export type Role = z.infer<typeof Role>;
