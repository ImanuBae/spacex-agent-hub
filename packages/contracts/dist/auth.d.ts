import { z } from "zod";
export declare const TokenClaims: z.ZodObject<{
    sub: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        director: "director";
        admissions: "admissions";
        accountant: "accountant";
        teacher: "teacher";
    }>;
    branchId: z.ZodNullable<z.ZodString>;
    exp: z.ZodNumber;
}, z.core.$strip>;
export type TokenClaims = z.infer<typeof TokenClaims>;
