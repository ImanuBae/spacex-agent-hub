import { importSPKI, jwtVerify } from "jose";
import { z } from "zod";
import { bearer, iamRequest } from "@spacex/auth";
import { MachineClaims } from "@spacex/contracts";
import { HttpError } from "@spacex/http";
import type { RequestHandler, Response } from "express";

export const MachineConfig = z.object({
  publicKey: z.string().min(1), issuer: z.string().min(1),
  subjects: z.record(z.string(), z.array(z.string().min(1)).min(1)),
});
export type MachineConfig = z.infer<typeof MachineConfig>;
const Claims = z.object({
  sub: z.string().min(1), iat: z.number().int(), exp: z.number().int(),
  scope: z.string(), workflows: z.array(z.string()).min(1),
});
type Machine = z.infer<typeof Claims>;
export function machineAuth(config: MachineConfig | undefined, scope: string, identityUrl: string): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!config) throw new HttpError(503, "MACHINE_AUTH_NOT_CONFIGURED", "N8N-03 machine authority required");
      let claims: Machine;
      try {
        const result = await jwtVerify(bearer(req.get("authorization")), await importSPKI(config.publicKey, "RS256"), {
          algorithms: ["RS256"], issuer: config.issuer, audience: "automation-bridge",
          requiredClaims: ["sub", "iat", "exp"], maxTokenAge: "5m",
          clockTolerance: 1,
        });
        claims = Claims.parse(result.payload);
        // Allow one-second issuance jitter across processes, but never extend absolute expiry.
        if (claims.exp - claims.iat > 300 || claims.exp <= claims.iat || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Invalid token lifetime");
      } catch { throw new HttpError(401, "UNAUTHORIZED", "Invalid or expired machine token"); }
      const current = MachineClaims.parse(await iamRequest(identityUrl, "/internal/iam/machine/introspect", bearer(req.get("authorization")), { audience: "automation-bridge", scope }));
      if (current.sub !== claims.sub) throw new HttpError(401, "UNAUTHORIZED", "Invalid machine principal");
      const allowed = Object.hasOwn(config.subjects, claims.sub) ? config.subjects[claims.sub] : undefined;
      if (!allowed || !claims.scope.split(" ").includes(scope))
        throw new HttpError(403, "FORBIDDEN", "Machine scope denied");
      res.locals.machine = { ...claims, workflows: claims.workflows.filter(w => allowed.includes(w)) };
      next();
    } catch (error) { next(error); }
  };
}
export function machine(res: Response, workflowId: string) {
  const actor = res.locals.machine as Machine | undefined;
  if (!actor?.workflows.includes(workflowId)) throw new HttpError(403, "FORBIDDEN", "Workflow access denied");
  return actor.sub;
}
