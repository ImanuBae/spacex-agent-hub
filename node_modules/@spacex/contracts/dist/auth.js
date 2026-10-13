import { z } from "zod";
import { Role } from "./roles.js";
export const TokenClaims = z.object({
    sub: z.string(),
    role: Role,
    branchId: z.string().nullable(),
    exp: z.number(),
});
