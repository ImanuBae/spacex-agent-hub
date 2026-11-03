import { SignJWT, jwtVerify } from "jose";
import { TokenClaims, type Role } from "@spacex/contracts";
import { HttpError } from "@spacex/http";
import type { RequestHandler, Response } from "express";

export interface Principal extends TokenClaims { sid: string; }
export interface AuthConfig { secret: string; issuer: string; audience: string; identityUrl: string; }

export function authConfig(env = process.env): AuthConfig {
  const secret = env.AUTH_SECRET ?? "";
  if (Buffer.byteLength(secret) < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes");
  return { secret, issuer: env.AUTH_ISSUER ?? "spacex-identity", audience: env.AUTH_AUDIENCE ?? "spacex-services", identityUrl: env.IDENTITY_URL ?? "http://127.0.0.1:4002" };
}

export async function signAccessToken(user: { id: string; role: Role; branchIds: string[] }, sid: string, config: AuthConfig, ttl = 300) {
  return new SignJWT({ role: user.role, branchIds: user.branchIds, sid }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime(`${ttl}s`)
    .sign(new TextEncoder().encode(config.secret));
}

export async function verifyAccessToken(token: string, config: AuthConfig): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.secret), { algorithms: ["HS256"], issuer: config.issuer, audience: config.audience, requiredClaims: ["sub", "exp", "iat", "sid"] });
    const claims = TokenClaims.parse(payload);
    if (typeof payload.sid !== "string" || !payload.sid) throw new Error("Missing session");
    return { ...claims, sid: payload.sid };
  } catch { throw new HttpError(401, "UNAUTHORIZED", "Invalid or expired session"); }
}

export function bearer(header?: string) {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  if (!match) throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  return match[1];
}

export function authenticate(config: AuthConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = bearer(req.get("authorization"));
      const claims = await verifyAccessToken(token, config);
      let response: globalThis.Response;
      try {
        response = await fetch(`${config.identityUrl}/api/v1/auth/introspect`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-correlation-id": res.locals.correlationId, ...(res.locals.traceparent ? { traceparent: res.locals.traceparent } : {}) }, signal: AbortSignal.timeout(5000) });
      } catch { throw new HttpError(503, "IDENTITY_UNAVAILABLE", "Identity service unavailable"); }
      if (response.status === 401) throw new HttpError(401, "UNAUTHORIZED", "Session revoked or expired");
      if (!response.ok) throw new HttpError(503, "IDENTITY_UNAVAILABLE", "Identity service unavailable");
      const data = await response.json() as { data: Principal };
      if (data.data.sub !== claims.sub || data.data.sid !== claims.sid) throw new HttpError(401, "UNAUTHORIZED", "Invalid session");
      res.locals.principal = claims;
      next();
    } catch (error) { next(error); }
  };
}

export function principal(res: Response): Principal {
  if (!res.locals.principal) throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
  return res.locals.principal as Principal;
}

export function allowRoles(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const user = principal(res);
    if (!roles.includes(user.role)) { next(new HttpError(403, "FORBIDDEN", "Insufficient permission")); return; }
    next();
  };
}

export function checkBranch(user: Principal, branchId: string) {
  if (user.role !== "center_director" && !user.branchIds.includes(branchId)) throw new HttpError(403, "FORBIDDEN", "Branch access denied");
}
