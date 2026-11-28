import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Express } from "express";
import { ErasureProof, ErasureScope, MachineClaims, RestoreExclusions } from "@spacex/contracts";
import { HttpError } from "@spacex/http";
import { bearer, iamRequest, type AuthConfig } from "./index.js";

export const erasureTestEnabled = () => process.env.NODE_ENV === "test" && process.env.WF12_ERASURE_TEST === "true";

export async function erasureWorker(auth: AuthConfig, authorization?: string) {
  const token = bearer(authorization);
  const worker = MachineClaims.parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/introspect", token, {
    audience:"crm", scope:"erasure:process",
  }));
  if (!worker.workflows.includes("WF-12")) throw new HttpError(403, "FORBIDDEN", "WF-12 erasure worker required");
  return token;
}

export const erasureProofSchema = `CREATE TABLE erasure_proofs (
 request_id uuid PRIMARY KEY, person_id uuid NOT NULL, branch_id uuid NOT NULL,
 evidence_ref uuid NOT NULL UNIQUE, status text NOT NULL CHECK(status IN ('DONE','NOT_APPLICABLE','BLOCKED')),
 code text NOT NULL, checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
)`;

export type ErasureClient = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};
type Outcome = Pick<ErasureProof, "status" | "code">;
type ErasurePool = { connect(): Promise<ErasureClient> };
type Decide = (client: ErasureClient, scope: ErasureScope) => Promise<Outcome>;

export async function readRestoreExclusions(file: string, expectedSha: string | undefined) {
  if (!erasureTestEnabled()) throw new Error("WF-12 restore exclusions require the synthetic restore runtime");
  const bytes = await readFile(file);
  if (!expectedSha || createHash("sha256").update(bytes).digest("hex") !== expectedSha)
    throw new Error("Restore exclusion digest mismatch");
  return RestoreExclusions.parse(JSON.parse(bytes.toString("utf8")));
}

export async function applyErasureProof(pool: ErasurePool, scope: ErasureScope, decide: Decide) {
  const id = scope.requestId;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,120000))", [id]);
    const old = (await c.query("SELECT * FROM erasure_proofs WHERE request_id=$1", [id])).rows[0];
    if (old && (old.person_id !== scope.personId || old.branch_id !== scope.branchId))
      throw new HttpError(409, "ERASURE_SCOPE_MISMATCH", "Receipt owner mismatch");
    const proof = old && old.status !== "BLOCKED"
      ? ErasureProof.parse({status:old.status,code:old.code,evidenceRef:old.evidence_ref})
      : ErasureProof.parse({ ...await decide(c,scope), evidenceRef:old?.evidence_ref ?? randomUUID() });
    await c.query(`INSERT INTO erasure_proofs(request_id,person_id,branch_id,evidence_ref,status,code) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(request_id) DO UPDATE SET status=EXCLUDED.status,code=EXCLUDED.code,checked_at=clock_timestamp()
      WHERE (erasure_proofs.status,erasure_proofs.code) IS DISTINCT FROM (EXCLUDED.status,EXCLUDED.code)`,
    [id, scope.personId, scope.branchId, proof.evidenceRef, proof.status, proof.code]);
    await c.query("COMMIT");
    return proof;
  } catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}

export function registerErasureTarget(app: Express, auth: AuthConfig, pool: ErasurePool, decide: Decide) {
  const crmUrl = process.env.CRM_URL;
  if (!erasureTestEnabled() || !crmUrl) return;
  app.post("/internal/erasure/:id", async (req, res) => {
    const id = ErasureScope.shape.requestId.parse(req.params.id);
    const token = await erasureWorker(auth, req.get("authorization"));
    const lookup = await fetch(`${crmUrl}/internal/crm/erasure/${id}/scope`, {
      headers:{ authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(3000), redirect:"error",
    });
    if (!lookup.ok) throw new HttpError(409, "ERASURE_SCOPE_UNAVAILABLE", "CRM did not confirm an active verified erasure");
    const scope = ErasureScope.parse((await lookup.json()).data);
    if (scope.requestId !== id) throw new HttpError(409, "ERASURE_SCOPE_MISMATCH", "Verified scope mismatch");
    res.json({ data:await applyErasureProof(pool,scope,decide) });
  });
}
