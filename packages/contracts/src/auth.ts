import { z } from "zod";
import { Role } from "./roles.js";

export const TokenClaims = z.object({
  sub: z.string().min(1),
  role: Role,
  branchIds: z.array(z.string().uuid()),
  exp: z.number().int().positive(),
});
export type TokenClaims = z.infer<typeof TokenClaims>;
