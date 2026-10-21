import type { Express } from "express";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CourseInput, CoursePackageInput, ListQuery } from "@spacex/contracts";
import { HttpError } from "./app.js";
import { db } from "./db/client.js";
import { coursePackages, courses } from "./db/schema.js";

const IdParam = z.string().uuid();

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


export function registerCatalogRoutes(app: Express) {
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
        const { page, pageSize } = ListQuery.parse(req.query);
        const rows = await db
            .select()
            .from(courses)
            .orderBy(desc(courses.createdAt), desc(courses.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize);
        const [totalRow] = await db.select({ total: count() }).from(courses);
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

    app.delete("/api/v1/courses/:id", async (req, res) => {
        const id = IdParam.parse(req.params.id);
        try {
            const [row] = await db.delete(courses).where(eq(courses.id, id)).returning({ id: courses.id });
            if (!row) {
                throw new HttpError(404, "NOT_FOUND", "Course not found");
            }
            res.json({ data: { success: true } });
        } catch (error) {
            if (pgErrorCode(error) === "23503") {
                throw new HttpError(409, "CONFLICT", "Course has packages and cannot be deleted");
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
        const { page, pageSize } = ListQuery.parse(req.query);
        const rows = await db
            .select()
            .from(coursePackages)
            .orderBy(desc(coursePackages.createdAt), desc(coursePackages.id))
            .limit(pageSize)
            .offset((page - 1) * pageSize);
        const [totalRow] = await db.select({ total: count() }).from(coursePackages);
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
