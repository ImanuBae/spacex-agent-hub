import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { like } from "drizzle-orm";
import { createApp } from "./app.js";
import type * as ClientModule from "./db/client.js";
import { coursePackages, courses } from "./db/schema.js";

// Test chạm DB thật: ưu tiên CATALOG_TEST_DATABASE_URL, fallback sang DATABASE_URL từ .env
const testDatabaseUrl = process.env.CATALOG_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!testDatabaseUrl) {
    console.warn("\n⚠️ [CATALOG TEST] Các test PostgreSQL bị bỏ qua do thiếu biến CATALOG_TEST_DATABASE_URL hoặc DATABASE_URL. Để chạy: bật Postgres và chạy npm run test:db hoặc truyền biến môi trường.\n");
}
// Mã duy nhất cho mỗi lần chạy, để không đụng seed hay các lần chạy trước.
const prefix = `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const GHOST = "00000000-0000-4000-8000-000000000000";

const courseBody = (suffix: string, overrides: object = {}) => ({
    code: `${prefix}-${suffix}`, name: "Test course", goal: "Test goal", level: "beginner",
    deliveryModes: ["online"], priceVnd: 1500000, ...overrides,
});
const packageBody = (courseId: string, suffix: string, overrides: object = {}) => ({
    courseId, code: `${prefix}-${suffix}`, name: "Test package", sessionCount: 12, priceVnd: 1200000, ...overrides,
});

describe.skipIf(!testDatabaseUrl)("catalog CRUD API (PostgreSQL)", () => {
    let server: Server;
    let base: string;
    let client: typeof ClientModule;
    let courseA: { id: string; code: string; createdAt: string; updatedAt: string };
    let packageA: { id: string; code: string };

    async function call(method: string, path: string, body?: unknown) {
        const response = await fetch(`${base}${path}`, {
            method, headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }

    beforeAll(async () => {
        process.env.DATABASE_URL = testDatabaseUrl;
        client = await import("./db/client.js");
        const { registerCatalogRoutes } = await import("./routes.js");
        const app = createApp("catalog-test", registerCatalogRoutes);
        await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        courseA = (await call("POST", "/api/v1/courses", courseBody("a"))).body.data;
        packageA = (await call("POST", "/api/v1/packages", packageBody(courseA.id, "a"))).body.data;
    });

    afterAll(async () => {
        // Xóa gói trước, rồi mới xóa khóa (khóa ngoại RESTRICT).
        await client.db.delete(coursePackages).where(like(coursePackages.code, `${prefix}%`));
        await client.db.delete(courses).where(like(courses.code, `${prefix}%`));
        await client.pool.end();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    describe("courses", () => {
        it("creates a course and returns price as a number", async () => {
            const { status, body } = await call("POST", "/api/v1/courses", courseBody("create"));
            expect(status).toBe(201);
            expect(body.data).toMatchObject({ code: `${prefix}-create`, status: "draft", description: "", branchIds: [] });
            expect(typeof body.data.id).toBe("string");
            expect(typeof body.data.priceVnd).toBe("number");
            expect(Number.isNaN(Date.parse(body.data.createdAt))).toBe(false);
        });
        it("rejects invalid data with field details", async () => {
            const { status, body } = await call("POST", "/api/v1/courses", { name: "", priceVnd: -1 });
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
            expect(body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "priceVnd" })]));
        });
        it("returns 409 for a duplicate code", async () => {
            const { status, body } = await call("POST", "/api/v1/courses", courseBody("a"));
            expect(status).toBe(409);
            expect(body.error.code).toBe("CONFLICT");
        });
        it("lists newest first with numeric pagination", async () => {
            const first = (await call("POST", "/api/v1/courses", courseBody("list1"))).body.data;
            const second = (await call("POST", "/api/v1/courses", courseBody("list2"))).body.data;
            const { status, body } = await call("GET", "/api/v1/courses?page=1&pageSize=100");
            expect(status).toBe(200);
            expect(body.pagination.page).toBe(1);
            expect(body.pagination.pageSize).toBe(100);
            expect(typeof body.pagination.total).toBe("number");
            const ids = body.data.map((course: { id: string }) => course.id);
            expect(ids).toContain(first.id);
            expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
        });
        it("gets by id, 404 for unknown id, 400 for malformed id", async () => {
            expect((await call("GET", `/api/v1/courses/${courseA.id}`)).body.data.id).toBe(courseA.id);
            const missing = await call("GET", `/api/v1/courses/${GHOST}`);
            expect(missing.status).toBe(404);
            expect(missing.body.error.code).toBe("NOT_FOUND");
            expect((await call("GET", "/api/v1/courses/abc")).status).toBe(400);
        });
        it("updates a course and keeps createdAt", async () => {
            const { status, body } = await call("PUT", `/api/v1/courses/${courseA.id}`,
                courseBody("a", { name: "Renamed", priceVnd: 1700000, status: "active" }));
            expect(status).toBe(200);
            expect(body.data).toMatchObject({ name: "Renamed", priceVnd: 1700000, status: "active", createdAt: courseA.createdAt });
            expect(Date.parse(body.data.updatedAt)).toBeGreaterThan(Date.parse(courseA.updatedAt));
        });
        it("returns 404 when updating an unknown course", async () => {
            expect((await call("PUT", `/api/v1/courses/${GHOST}`, courseBody("ghost"))).status).toBe(404);
        });
        it("returns 409 when updating to another course's code", async () => {
            await call("POST", "/api/v1/courses", courseBody("taken"));
            const { status, body } = await call("PUT", `/api/v1/courses/${courseA.id}`, courseBody("taken"));
            expect(status).toBe(409);
            expect(body.error.code).toBe("CONFLICT");
        });

        it("deletes a course and returns 404 when deleting it again", async () => {
            const created = (await call("POST", "/api/v1/courses", courseBody("delete"))).body.data;
            const { status, body } = await call("DELETE", `/api/v1/courses/${created.id}`);
            expect(status).toBe(200);
            expect(body.data).toEqual({ success: true });
            expect((await call("GET", `/api/v1/courses/${created.id}`)).status).toBe(404);
            expect((await call("DELETE", `/api/v1/courses/${created.id}`)).status).toBe(404);
        });

        it("rejects deleting a course that has packages", async () => {
            const { status, body } = await call("DELETE", `/api/v1/courses/${courseA.id}`);
            expect(status).toBe(409);
            expect(body.error.code).toBe("CONFLICT");
        });

        it("rejects unknown fields (strict mode)", async () => {
            const { status, body } = await call("POST", "/api/v1/courses",
                courseBody("strict", { extraField: "should be rejected" }));
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("rejects empty deliveryModes", async () => {
            const { status, body } = await call("POST", "/api/v1/courses",
                courseBody("empty-dm", { deliveryModes: [] }));
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("rejects invalid level enum", async () => {
            const { status, body } = await call("POST", "/api/v1/courses",
                courseBody("bad-level", { level: "expert" }));
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("packages", () => {
        it("creates a package and returns price as a number", async () => {
            const { status, body } = await call("POST", "/api/v1/packages", packageBody(courseA.id, "create"));
            expect(status).toBe(201);
            expect(body.data).toMatchObject({ courseId: courseA.id, code: `${prefix}-create`, sessionCount: 12 });
            expect(typeof body.data.priceVnd).toBe("number");
        });
        it("returns 404 when the course does not exist", async () => {
            const { status, body } = await call("POST", "/api/v1/packages", packageBody(GHOST, "orphan"));
            expect(status).toBe(404);
            expect(body.error.code).toBe("NOT_FOUND");
        });
        it("returns 409 for a duplicate package code", async () => {
            const { status, body } = await call("POST", "/api/v1/packages", packageBody(courseA.id, "a"));
            expect(status).toBe(409);
            expect(body.error.code).toBe("CONFLICT");
        });
        it("lists packages with numeric pagination", async () => {
            const { status, body } = await call("GET", "/api/v1/packages?page=1&pageSize=1");
            expect(status).toBe(200);
            expect(body.data.length).toBeLessThanOrEqual(1);
            expect(typeof body.pagination.total).toBe("number");
        });
        it("gets by id and returns 404 for unknown id", async () => {
            expect((await call("GET", `/api/v1/packages/${packageA.id}`)).body.data.id).toBe(packageA.id);
            expect((await call("GET", `/api/v1/packages/${GHOST}`)).status).toBe(404);
        });
        it("updates a package", async () => {
            const { status, body } = await call("PUT", `/api/v1/packages/${packageA.id}`,
                packageBody(courseA.id, "a", { name: "Renamed package", sessionCount: 24 }));
            expect(status).toBe(200);
            expect(body.data).toMatchObject({ name: "Renamed package", sessionCount: 24 });
        });
        it("returns 404 for unknown package id and unknown courseId on update", async () => {
            expect((await call("PUT", `/api/v1/packages/${GHOST}`, packageBody(courseA.id, "ghost"))).status).toBe(404);
            expect((await call("PUT", `/api/v1/packages/${packageA.id}`, packageBody(GHOST, "a"))).status).toBe(404);
        });
        it("returns 409 when updating to another package's code", async () => {
            await call("POST", "/api/v1/packages", packageBody(courseA.id, "taken"));
            expect((await call("PUT", `/api/v1/packages/${packageA.id}`, packageBody(courseA.id, "taken"))).status).toBe(409);
        });
        it("rejects invalid package data", async () => {
            const { status, body } = await call("POST", "/api/v1/packages",
                { courseId: courseA.id, code: "", name: "", sessionCount: 0, priceVnd: -1 });
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
            expect(body.error.details).toEqual(
                expect.arrayContaining([expect.objectContaining({ path: "sessionCount" })]));
        });
        it("rejects unknown fields on package (strict mode)", async () => {
            const { status, body } = await call("POST", "/api/v1/packages",
                packageBody(courseA.id, "pkg-strict", { extra: true }));
            expect(status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });
    });
});
