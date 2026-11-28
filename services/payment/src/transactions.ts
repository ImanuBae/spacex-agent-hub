import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { principal } from "@spacex/auth";

const query = z.object({
  q: z.string().trim().max(200).default(""),
  status: z.enum(["RECEIVED", "ALLOCATED", "REVIEW", "REFUND_PENDING", "REFUNDED"]).optional(),
  id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export function listTransactions(pool: Pool): RequestHandler {
  return async (req, res) => {
    const user = principal(res);
    const { q, status, id, page, pageSize } = query.parse(req.query);
    const { rows: [result] } = await pool.query(`
      WITH transactions AS (
        SELECT l.id, l.transaction_id AS "transactionId", l.reference, l.amount,
          l.received_at AS "receivedAt", l.received_at AS sort_at, l.provider = 'SYNTHETIC' AS demo,
          'INCOMING' AS kind, r.id AS "reviewId", NULL::uuid AS "receiptRef",
          CASE WHEN r.status = 'REFUND_PENDING' THEN 'REFUND_PENDING'
            WHEN r.id IS NOT NULL THEN 'REVIEW'
            WHEN a.ledger_id IS NOT NULL THEN 'ALLOCATED' ELSE 'RECEIVED' END AS status
        FROM payment_ledger l
        LEFT JOIN payment_requests p ON p.id = l.payment_id
        LEFT JOIN payment_allocations a ON a.ledger_id = l.id
        LEFT JOIN LATERAL (
          SELECT v.id, v.status FROM payment_reviews v
          WHERE v.ledger_id = l.id AND ($1 OR v.branch_id = ANY($2::uuid[])
            OR (v.branch_id IS NULL AND v.owner_id = $3))
          ORDER BY (v.status = 'REFUND_PENDING') DESC, v.deadline_at DESC, v.id LIMIT 1
        ) r ON true
        WHERE $1 OR p.branch_id = ANY($2::uuid[]) OR (p.id IS NULL AND r.id IS NOT NULL)
        UNION ALL
        -- Refund receipts belong to a payment request, which can have several incoming transfers.
        SELECT a.id, COALESCE(x.id, a.id)::text, p.reference, -a.amount_delta,
          x.created_at, COALESCE(x.created_at, a.created_at), true, 'REFUND', NULL::uuid, x.id,
          CASE WHEN x.id IS NOT NULL THEN 'REFUNDED' ELSE 'REFUND_PENDING' END
        FROM payment_adjustments a
        JOIN payment_requests p ON p.id = a.payment_id
        LEFT JOIN synthetic_payment_executions x ON x.id = a.receipt_id
          AND x.adjustment_id = a.id AND x.direction = 'REFUND' AND a.status = 'EXECUTED'
        WHERE ($1 OR a.branch_id = ANY($2::uuid[])) AND a.amount_delta < 0
          AND (x.id IS NOT NULL OR a.status IN ('WAITING', 'AUTHORIZED', 'RESERVED', 'UNKNOWN'))
      ), filtered AS (
        SELECT * FROM transactions WHERE ($4 = '' OR strpos(lower("transactionId"), lower($4)) > 0
          OR strpos(lower(reference), lower($4)) > 0)
          AND ($5::text IS NULL OR status = $5) AND ($6::uuid IS NULL OR id = $6)
      ), paged AS (
        SELECT * FROM filtered ORDER BY sort_at DESC, id DESC LIMIT $7 OFFSET $8
      )
      SELECT (SELECT count(*)::int FROM filtered) AS total,
        COALESCE(jsonb_agg(to_jsonb(paged) - 'sort_at' ORDER BY sort_at DESC, id DESC), '[]'::jsonb) AS data
      FROM paged
    `, [user.role === "center_director", user.branchIds, user.role === "accountant" ? user.sub : null,
      q, status ?? null, id ?? null, pageSize, (page - 1) * pageSize]);
    res.set("cache-control", "no-store").json({ data: result.data, pagination: { page, pageSize, total: result.total } });
  };
}
