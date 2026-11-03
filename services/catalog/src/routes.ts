import type { Express } from "express";
import { and, count, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { authenticate, allowRoles, authConfig, type AuthConfig } from "@spacex/auth";
import { CourseInput, CoursePackageInput, ListQuery } from "@spacex/contracts";
import { HttpError } from "./app.js";
import { db, pool } from "./db/client.js";
import { coursePackages, courses } from "./db/schema.js";

const IdParam = z.string().uuid();
const CatalogQuery = ListQuery.extend({
    courseId: z.uuid().optional(), status: z.enum(["draft", "active", "closed"]).optional(),
    search: z.string().trim().max(100).optional(), goal: z.string().trim().max(500).optional(),
    branchId: z.uuid().optional(), mode: z.enum(["onsite", "online"]).optional(),
    level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    minPriceVnd: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    maxPriceVnd: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    sellable: z.enum(["true", "false"]).default("false"),
}).refine(q => q.minPriceVnd === undefined || q.maxPriceVnd === undefined || q.minPriceVnd <= q.maxPriceVnd, { path: ["maxPriceVnd"], message: "Ngân sách tối đa phải từ ngân sách tối thiểu trở lên" });

// Drizzle có thể bọc lỗi Postgres trong error.cause, nên đọc cả hai chỗ.
function pgErrorCode(error: unknown): string | undefined {
    const e = error as { code?: string; cause?: { code?: string } } | null;
    return e?.cause?.code ?? e?.code;
}

// POST/PUT gói học: 23505 = trùng code (409), 23503 = courseId không tồn tại (404).
function throwPackageError(error: unknown): never {
    const code = pgErrorCode(error);
    if (code === "23505") {
        throw new HttpError(409, "CONFLICT", "Package code already exists");
    }
    if (code === "23503") {
        throw new HttpError(404, "NOT_FOUND", "Course not found");
    }
    throw error;
}


export function registerCatalogRoutes(app: Express, config: AuthConfig = authConfig()) {
    app.use("/api/v1", authenticate(config), allowRoles("center_director", "branch_director", "admissions", "teacher", "ai_agent"));
    app.use("/api/v1", (req, res, next) => {
        if (["GET", "HEAD"].includes(req.method)) { next(); return; }
        allowRoles("center_director")(req, res, next);
    });
    app.post("/api/v1/courses", async (req, res) => {
        const input = CourseInput.parse(req.body);
        try {
            const [row] = await db.insert(courses).values(input).returning();
            res.status(201).json({ data: row });
        } catch (error) {
            if (pgErrorCode(error) === "23505") {
                throw new HttpError(409, "CONFLICT", "Course code already exists");
            }
            throw error;
        }
    });

    app.get("/api/v1/courses", async (req, res) => {
        const { page, pageSize, status, search, branchId, mode, level, goal, minPriceVnd, maxPriceVnd, sellable } = CatalogQuery.parse(req.query);
        const budget = minPriceVnd !== undefined || maxPriceVnd !== undefined;
        const where = and(status ? eq(courses.status, status) : undefined, search ? ilike(courses.name, `%${search}%`) : undefined, goal ? ilike(courses.goal, `%${goal}%`) : undefined, level ? eq(courses.level, level) : undefined, branchId ? sql`(cardinality(${courses.branchIds})=0 OR ${branchId}::uuid=ANY(${courses.branchIds}))` : undefined, mode ? sql`${mode}=ANY(${courses.deliveryModes})` : undefined,
            sellable === "true" ? eq(courses.status, "active") : undefined,
            budget || sellable === "true" ? sql`EXISTS(SELECT 1 FROM course_packages p WHERE p.course_id=${courses.id} AND p.status='active' AND p.price_vnd>=${minPriceVnd ?? 0} AND p.price_vnd<=${maxPriceVnd ?? Number.MAX_SAFE_INTEGER})` : undefined);
        const rows = await db
            .select()
            .from(courses)
            .where(where)
            .orderBy(desc(courses.createdAt), desc(courses.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize);
        const [totalRow] = await db.select({ total: count() }).from(courses).where(where);
        res.json({ data: rows, pagination: { page, pageSize, total: totalRow?.total ?? 0 } });
    });

    app.get("/api/v1/courses/:id", async (req, res) => {
        const id = IdParam.parse(req.params.id);
        const [row] = await db.select().from(courses).where(eq(courses.id, id));
        if (!row) {
            throw new HttpError(404, "NOT_FOUND", "Course not found");
        }
        res.json({ data: row });
    });

    app.put("/api/v1/courses/:id", async (req, res) => {
        const id = IdParam.parse(req.params.id);
        const input = CourseInput.parse(req.body);
        try {
            const [row] = await db
                .update(courses)
                .set({ ...input, updatedAt: new Date() })
                .where(eq(courses.id, id))
                .returning();
            if (!row) {
                throw new HttpError(404, "NOT_FOUND", "Course not found");
            }
            res.json({ data: row });
        } catch (error) {
            if (pgErrorCode(error) === "23505") {
                throw new HttpError(409, "CONFLICT", "Course code already exists");
            }
            throw error;
        }
    });

    app.post("/api/v1/packages", async (req, res) => {
        const input = CoursePackageInput.parse(req.body);
        try {
            const [row] = await db.insert(coursePackages).values(input).returning();
            res.status(201).json({ data: row });
        } catch (error) {
            throwPackageError(error);
        }
    });

    app.get("/api/v1/packages", async (req, res) => {
        const { page, pageSize, courseId, status, search, minPriceVnd, maxPriceVnd, sellable, goal, branchId, mode, level } = CatalogQuery.parse(req.query);
        const where = and(courseId ? eq(coursePackages.courseId, courseId) : undefined, status ? eq(coursePackages.status, status) : undefined, search ? ilike(coursePackages.name, `%${search}%`) : undefined,
            minPriceVnd !== undefined ? sql`${coursePackages.priceVnd}>=${minPriceVnd}` : undefined,
            maxPriceVnd !== undefined ? sql`${coursePackages.priceVnd}<=${maxPriceVnd}` : undefined,
            sellable === "true" ? eq(coursePackages.status, "active") : undefined,
            sql`EXISTS(SELECT 1 FROM courses c WHERE c.id=${coursePackages.courseId}
              AND (${sellable}='false' OR c.status='active')
              AND (${goal ?? null}::text IS NULL OR c.goal ILIKE ${`%${goal ?? ""}%`})
              AND (${level ?? null}::text IS NULL OR c.level=${level ?? null})
              AND (${mode ?? null}::text IS NULL OR ${mode ?? null}=ANY(c.delivery_modes))
              AND (${branchId ?? null}::uuid IS NULL OR cardinality(c.branch_ids)=0 OR ${branchId ?? null}::uuid=ANY(c.branch_ids)))`);
        const rows = await db
            .select()
            .from(coursePackages)
            .where(where)
            .orderBy(desc(coursePackages.createdAt), desc(coursePackages.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize);
        const [totalRow] = await db.select({ total: count() }).from(coursePackages).where(where);
        res.json({ data: rows, pagination: { page, pageSize, total: totalRow?.total ?? 0 } });
    });

    app.get("/api/v1/packages/:id", async (req, res) => {
        const id = IdParam.parse(req.params.id);
        const [row] = await db.select().from(coursePackages).where(eq(coursePackages.id, id));
        if (!row) {
            throw new HttpError(404, "NOT_FOUND", "Package not found");
        }
        res.json({ data: row });
    });

    for (const [resource, entity] of [["courses", "courses"], ["packages", "course_packages"]]) {
        app.get(`/api/v1/${resource}/:id/history`, async (req, res) => {
            const id = IdParam.parse(req.params.id);
            const { rows } = await pool.query("SELECT version,effective_at AS \"effectiveAt\",snapshot FROM offer_history WHERE entity=$1 AND entity_id=$2 ORDER BY version DESC", [entity, id]);
            if (!rows.length) throw new HttpError(404, "NOT_FOUND", "Offer not found");
            res.json({ data: rows });
        });
    }
    app.get("/api/v1/packages/:id/quote", async (req, res) => {
        const id = IdParam.parse(req.params.id);
        const { rows } = await pool.query("SELECT p.id AS \"packageId\",p.course_id AS \"courseId\",p.price_vnd AS \"priceVnd\",p.session_count AS \"sessionCount\",p.policy_version AS \"packageVersion\",c.policy_version AS \"courseVersion\",p.policy_text AS \"packagePolicy\",c.policy_text AS \"coursePolicy\",p.effective_at AS \"effectiveAt\",statement_timestamp() AS \"quotedAt\" FROM course_packages p JOIN courses c ON c.id=p.course_id WHERE p.id=$1 AND p.status='active' AND c.status='active'", [id]);
        if (!rows[0]) throw new HttpError(409, "NOT_SELLABLE", "Course/package not active");
        res.json({ data: { ...rows[0], priceVnd: Number(rows[0].priceVnd), currency: "VND" } });
    });

    app.put("/api/v1/packages/:id", async (req, res) => {
        const id = IdParam.parse(req.params.id);
        const input = CoursePackageInput.parse(req.body);
        try {
            const [row] = await db
                .update(coursePackages)
                .set({ ...input, updatedAt: new Date() })
                .where(eq(coursePackages.id, id))
                .returning();
            if (!row) {
                throw new HttpError(404, "NOT_FOUND", "Package not found");
            }
            res.json({ data: row });
        } catch (error) {
            throwPackageError(error);
        }
    });
}
