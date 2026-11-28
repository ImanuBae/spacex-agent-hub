import { applyErasureProof, readRestoreExclusions, type ErasureClient } from "@spacex/auth";
import type { ErasureProof, ErasureScope } from "@spacex/contracts";
import type { Pool } from "pg";

export async function eraseConversation(c: ErasureClient, scope: ErasureScope): Promise<Pick<ErasureProof,"status"|"code">> {
  const ids = [...new Set(scope.conversationIds)];
  if (!ids.length) return {status:"NOT_APPLICABLE",code:"NO_SCOPED_DATA"};
  const args = [scope.branchId,ids];
  const sessions = (await c.query(`SELECT s.id FROM chat_sessions s JOIN conversations v ON v.session_id=s.id
    WHERE v.branch_id=$1 AND s.branch_id=$1 AND v.id=ANY($2::uuid[]) ORDER BY s.id FOR UPDATE OF s`,args)).rows;
  if (sessions.length !== ids.length) return {status:"BLOCKED",code:"UNVERIFIED_SCOPE"};
  await c.query("SELECT id FROM conversations WHERE branch_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",args);
  const {rows:[recent]} = await c.query(`SELECT EXISTS(SELECT 1 FROM chat_messages WHERE conversation_id=ANY($2::uuid[])
    AND created_at>=clock_timestamp()-interval '90 days' UNION ALL SELECT 1 FROM conversations
    WHERE branch_id=$1 AND id=ANY($2::uuid[]) AND updated_at>=clock_timestamp()-interval '90 days') AS found`,args);
  if (!scope.noEnrollment || recent.found) return {status:"BLOCKED",code:"RETENTION"};
  await c.query("UPDATE chat_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])",[sessions.map(s=>s.id)]);
  await c.query("UPDATE chat_messages SET text='Đã ẩn danh',sources='[]',model=NULL WHERE conversation_id=ANY($1::uuid[])",[ids]);
  await c.query("DELETE FROM chat_contexts WHERE conversation_id=ANY($1::uuid[])",[ids]);
  await c.query(`WITH erased AS (
    UPDATE conversations SET erased_at=clock_timestamp(),version=version+1
    WHERE branch_id=$1 AND id=ANY($2::uuid[]) AND erased_at IS NULL RETURNING id,version
  ) INSERT INTO conversation_audit(id,conversation_id,actor,action,version)
    SELECT gen_random_uuid(),id,'WF-12','privacy.anonymized',version FROM erased`,args);
  return {status:"DONE",code:"ANONYMIZED"};
}

export async function restoreConversationExclusions(pool: Pool, file: string, expectedSha: string | undefined) {
  for (const scope of await readRestoreExclusions(file,expectedSha)) {
    if (!scope.conversationIds.length) continue;
    const proof = await applyErasureProof(pool,scope,eraseConversation);
    if (proof.status !== "DONE") throw new Error("A verified conversation exclusion could not be applied");
  }
}
