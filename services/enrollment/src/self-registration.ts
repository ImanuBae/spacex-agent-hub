import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { CourseNoticesConsent, RegistrationConsent, SelfRegistrationPerson, type PublicClass, type PublicOffer } from "@spacex/contracts";
import { HttpError, requireServiceSecret } from "@spacex/http";
import type { EnrollmentConfig } from "./app.js";

const id = z.uuid();
const key = z.uuidv4();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const missing = () => new HttpError(404, "CHECKOUT_NOT_FOUND", "Không tìm thấy đơn trên trình duyệt này.");
const stale = () => new HttpError(409, "OFFER_CHANGED", "Giá, điều khoản hoặc lịch lớp đã thay đổi. Vui lòng kiểm tra lại.");
const unavailable = () => new HttpError(409, "CLASS_UNAVAILABLE", "Lớp đã hết chỗ hoặc ngừng nhận đăng ký.");

interface DraftOffer {
  packageId: string;
  packageName: string;
  courseName: string;
  cls: PublicClass;
  quote: Record<string, unknown> & {
    courseId: string; sessionCount: number; priceVnd: number; courseVersion: number; packageVersion: number;
    coursePolicy: string; packagePolicy: string;
  };
  quoteVersion: string;
  terms: string;
  termsVersion: string;
}
interface Draft {
  id: string; enrollment_id: string; event_id: string; browser_key_hash: string; offer: DraftOffer;
  expires_at: Date; expired: boolean; email_hash: string | null;
}
interface Payment {
  id: string; amountDue: number; reference: string; status: string; expiresAt: string; adapter: string;
  qrImageDataUrl?: string; qrImageUrl?: string; moneyStatus: string;
}

export function registerSelfRegistration(app: Express, pool: Pool, config: EnrollmentConfig, {
  terms, termsVersion, quoteVersion, tx, emit, audit, identityUrl,
}: {
  terms: string; termsVersion: string; identityUrl: string; quoteVersion: (quote: DraftOffer["quote"]) => string;
  tx: <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;
  emit: (client: PoolClient, draft: Draft) => Promise<string>;
  audit: (client: PoolClient, id: string, actor: string, action: string, correlation: string) => Promise<void>;
}) {
  const root = "/api/v1/public-checkouts";
  function enabled() {
    if ([config.selfRegistrationCrmSecret, config.selfRegistrationIamSecret, config.selfRegistrationPaymentSecret].some(value => Buffer.byteLength(value ?? "") < 32))
      throw new HttpError(503, "CHECKOUT_UNAVAILABLE", "Đăng ký trực tuyến đang tạm dừng. Bạn có thể mở tư vấn để được hỗ trợ.");
  }
  async function read<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try { response = await fetch(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(4000) }); }
    catch { throw new HttpError(503, "SOURCE_UNAVAILABLE", "Dịch vụ đăng ký tạm thời gián đoạn. Vui lòng thử lại."); }
    if (!response.ok) {
      const error = (await response.json().catch(() => null))?.error;
      if ([404, 409].includes(response.status)) throw new HttpError(response.status, error?.code ?? "SOURCE_CHANGED", error?.message ?? "Dữ liệu đăng ký đã thay đổi.");
      throw new HttpError(503, "SOURCE_UNAVAILABLE", "Dịch vụ đăng ký tạm thời gián đoạn. Vui lòng thử lại.");
    }
    return (await response.json() as { data: T }).data;
  }
  async function classes(offer: PublicOffer, classId?: string) {
    if (!offer.sellable) return [];
    const rows = await read<PublicClass[]>(config.classUrl, `/public/classes/${offer.packageId}${classId ? `?classId=${classId}` : ""}`);
    return rows.filter(cls => cls.courseId === offer.courseId && cls.sessionCount === offer.sessionCount &&
      offer.deliveryModes.includes(cls.mode) && (!offer.branchIds.length || offer.branchIds.includes(cls.branchId)));
  }
  async function currentOffer(packageId: string, classId: string) {
    const offer = await read<PublicOffer>(config.catalogUrl, `/api/v1/public-offers/${packageId}`);
    const [cls] = await classes(offer, classId);
    if (!cls?.availableSeats) throw unavailable();
    const quote = await read<DraftOffer["quote"]>(config.catalogUrl, `/public/catalog/quotes/${packageId}?branchId=${cls.branchId}`);
    if (quote.courseId !== cls.courseId || quote.sessionCount !== cls.sessionCount || !Number.isSafeInteger(quote.priceVnd) || quote.priceVnd <= 0 || quote.priceVnd > 1_000_000_000)
      throw unavailable();
    return { packageId, packageName: offer.packageName, courseName: offer.courseName, cls, quote, quoteVersion: quoteVersion(quote), terms, termsVersion };
  }
  async function draftByKey(db: Pool | PoolClient, browserKey: string, lock = false) {
    return (await db.query<Draft>(`SELECT *,expires_at<=clock_timestamp() AS expired FROM self_registrations
      WHERE browser_key_hash=$1${lock ? " FOR UPDATE" : ""}`, [hash(browserKey)])).rows[0];
  }
  const summary = (d: Draft) => ({
    id: d.id, className: d.offer.cls.name, classCode: d.offer.cls.code, packageName: d.offer.packageName, courseName: d.offer.courseName,
    amountDue: d.offer.quote.priceVnd, terms: d.offer.terms, coursePolicy: d.offer.quote.coursePolicy, packagePolicy: d.offer.quote.packagePolicy,
    registrationConsent: RegistrationConsent, courseNoticesConsent: CourseNoticesConsent, expiresAt: d.expires_at,
  });
  const crmHeaders = () => ({ "x-enrollment-crm-secret": config.selfRegistrationCrmSecret!, "content-type": "application/json" });

  app.get(`${root}/classes/:packageId`, async (req, res) => {
    const offer = await read<PublicOffer>(config.catalogUrl, `/api/v1/public-offers/${id.parse(req.params.packageId)}`);
    res.set("cache-control", "no-store").json({ data: await classes(offer) });
  });
  app.post(`${root}/preview`, async (req, res) => {
    enabled();
    const input = z.object({ packageId: id, classId: id }).strict().parse(req.body), browserKey = key.parse(req.get("x-checkout-key"));
    const draft = await tx(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,4008))", [hash(browserKey)]);
      const old = await draftByKey(c, browserKey);
      if (old) {
        if (old.offer.packageId !== input.packageId || old.offer.cls.id !== input.classId) throw stale();
        if (old.expired && !old.email_hash) throw new HttpError(409, "PREVIEW_EXPIRED", "Phiếu kiểm tra đã hết hạn. Vui lòng kiểm tra lại.");
        return old;
      }
      const offer = await currentOffer(input.packageId, input.classId);
      return (await c.query<Draft>(`INSERT INTO self_registrations(id,enrollment_id,browser_key_hash,event_id,offer)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [randomUUID(), randomUUID(), hash(browserKey), randomUUID(), offer])).rows[0];
    });
    res.set("cache-control", "no-store").status(201).json({ data: summary(draft) });
  });
  app.post(`${root}/:id/confirm`, async (req, res) => {
    enabled();
    const checkoutId = id.parse(req.params.id), browserKey = key.parse(req.get("x-checkout-key"));
    const { person } = z.object({ accepted: z.literal(true), person: SelfRegistrationPerson }).strict().parse(req.body);
    await tx(async c => {
      const d = await draftByKey(c, browserKey, true);
      if (!d || d.id !== checkoutId) throw missing();
      if (d.email_hash) return;
      if (d.expired) throw new HttpError(409, "PREVIEW_EXPIRED", "Phiếu kiểm tra đã hết hạn. Vui lòng kiểm tra lại.");
      const { offer } = d, current = await currentOffer(offer.packageId, offer.cls.id);
      if (current.quoteVersion !== offer.quoteVersion || current.cls.version !== offer.cls.version || termsVersion !== offer.termsVersion) throw stale();
      await read(identityUrl, "/internal/iam/checkout-email", { method: "POST",
        headers: { "content-type": "application/json", "x-enrollment-iam-secret": config.selfRegistrationIamSecret! },
        body: JSON.stringify({ email: person.email }),
      });
      const actor = id.parse(config.sourceClientId);
      const contextId = await emit(c, d);
      const crm = await read<{ contactId: string; learnerId: string; payerId: string; branchId: string }>(config.crmUrl, `/internal/crm/self-registration/${d.id}`, {
        method: "POST", headers: crmHeaders(), body: JSON.stringify({ person, branchId: offer.cls.branchId, actorId: actor, termsVersion }),
      });
      if (crm.branchId !== offer.cls.branchId) throw stale();
      const snapshot = {
        contactId: crm.contactId, learnerId: crm.learnerId, payerId: crm.payerId, classId: offer.cls.id, packageId: offer.packageId,
        classVersion: offer.cls.version, branchId: crm.branchId, actorId: actor, amountDue: offer.quote.priceVnd, currency: "VND",
        className: offer.cls.name, packageName: offer.packageName,
        quoteId: offer.quoteVersion, quoteVersion: offer.quoteVersion, policyVersion: `${offer.quote.courseVersion}:${offer.quote.packageVersion}`,
        termsVersion, terms, quote: offer.quote, crm, selfRegistration: true,
      };
      await c.query(`INSERT INTO confirmations(id,enrollment_id,actor_id,session_id,branch_id,snapshot,payload,operation_key,event_id,status,context_id)
        VALUES($1,$2,$3,$4,$5,$6,'{}',$1,$7,'CONFIRMED',$4)`, [d.id, d.enrollment_id, actor, contextId, crm.branchId, snapshot, d.event_id]);
      await c.query("UPDATE self_registrations SET email_hash=$2 WHERE id=$1", [d.id, hash(d.browser_key_hash + person.email)]);
      await audit(c, d.id, actor, "confirmation.self_registered", d.enrollment_id);
    });
    res.set("cache-control", "no-store").status(202).json({ data: { id: checkoutId } });
  });
  app.get(`${root}/:id`, async (req, res) => {
    const checkoutId = id.parse(req.params.id), browserKey = key.parse(req.get("x-checkout-key"));
    const d = await draftByKey(pool, browserKey);
    if (!d || d.id !== checkoutId) throw missing();
    const row = (await pool.query(`SELECT c.expires_at<=clock_timestamp() AS confirmation_expired,e.status,e.expires_at,
      e.expires_at<=clock_timestamp() AS hold_expired FROM confirmations c LEFT JOIN enrollments e ON e.id=c.enrollment_id WHERE c.id=$1`, [d.id])).rows[0];
    const payment = row?.status ? await read<Payment | null>(config.paymentUrl, `/internal/payment/self-registration/${d.enrollment_id}`, {
      headers: { "x-enrollment-payment-secret": config.selfRegistrationPaymentSecret ?? "" },
    }).catch(error => { if (row.status === "CONFIRMED") return null; throw error; }) : null;
    const status = !row ? (d.expired ? "EXPIRED" : "DRAFT")
      : row.status === "CONFIRMED" ? "CONFIRMED"
      : ["PAYMENT_REVIEW", "REFUND_PENDING"].includes(row.status) || payment?.moneyStatus === "REVIEW" ? "REVIEW"
      : row.status === "CONFIRMING" || payment?.moneyStatus.startsWith("MATCHED") ? "CONFIRMING"
      : row.status === "EXPIRED" || row.hold_expired || payment?.status === "EXPIRED" || !row.status && row.confirmation_expired ? "EXPIRED"
      : ["CANCELLED", "NEEDS_CONFIRMATION"].includes(row.status) ? "UNAVAILABLE"
      : payment?.status === "OPEN" ? "AWAITING_PAYMENT" : "PREPARING";
    res.set("cache-control", "no-store").json({ data: {
      ...summary(d), status, holdExpiresAt: row?.expires_at ?? payment?.expiresAt ?? null,
      payment: payment ? { ...payment, qrImageUrl: status === "AWAITING_PAYMENT" ? payment.qrImageUrl : undefined,
        qrImageDataUrl: status === "AWAITING_PAYMENT" ? payment.qrImageDataUrl : undefined } : null,
    } });
  });
  app.post("/internal/enrollment/self-registration/:id/learner", async (req, res) => {
    requireServiceSecret(config.selfRegistrationIamSecret, req.get("x-enrollment-iam-secret"));
    const checkoutId = id.parse(req.params.id), { browserKey } = z.object({ browserKey: key }).strict().parse(req.body);
    const d = await draftByKey(pool, browserKey);
    if (!d || d.id !== checkoutId || !d.email_hash) throw missing();
    const row = (await pool.query("SELECT learner_id,branch_id FROM enrollments WHERE id=$1 AND status='CONFIRMED'", [d.enrollment_id])).rows[0];
    if (!row) throw new HttpError(409, "ENROLLMENT_NOT_CONFIRMED", "Đăng ký đang chờ xác nhận chỗ.");
    const learner = await read<{ learnerId: string; branchId: string; name: string; email: string }>(config.crmUrl,
      `/internal/crm/self-registration/${checkoutId}/learner`, { headers: crmHeaders() });
    if (learner.learnerId !== row.learner_id || learner.branchId !== row.branch_id || hash(d.browser_key_hash + learner.email) !== d.email_hash) throw missing();
    res.set("cache-control", "no-store").json({ data: { ...learner, enrollmentId: d.enrollment_id } });
  });
}
