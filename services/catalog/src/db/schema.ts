import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const courses = pgTable(
    "courses",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        code: varchar("code", { length: 50 }).notNull().unique(),
        name: varchar("name", { length: 200 }).notNull(),
        description: text("description").notNull().default(""),
        goal: varchar("goal", { length: 500 }).notNull(),
        level: varchar("level", { length: 20 }).notNull(),
        deliveryModes: text("delivery_modes").array().notNull(),
        branchIds: uuid("branch_ids").array().notNull().default(sql`'{}'::uuid[]`),
        priceVnd: bigint("price_vnd", { mode: "number" }).notNull(),
        status: varchar("status", { length: 20 }).notNull().default("draft"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check("courses_level_check", sql`${table.level} IN ('beginner', 'intermediate', 'advanced')`),
        check("courses_status_check", sql`${table.status} IN ('draft', 'active', 'closed')`),
        check("courses_price_vnd_check", sql`${table.priceVnd} >= 0`),
        check(
            "courses_delivery_modes_check",
            sql`cardinality(${table.deliveryModes}) >= 1 AND ${table.deliveryModes} <@ ARRAY['onsite', 'online']::text[]`,
        ),
    ],
);

export const coursePackages = pgTable(
    "course_packages",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        courseId: uuid("course_id")
            .notNull()
            .references(() => courses.id, { onDelete: "restrict" }),
        code: varchar("code", { length: 50 }).notNull().unique(),
        name: varchar("name", { length: 200 }).notNull(),
        sessionCount: integer("session_count").notNull(),
        priceVnd: bigint("price_vnd", { mode: "number" }).notNull(),
        status: varchar("status", { length: 20 }).notNull().default("draft"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check("course_packages_session_count_check", sql`${table.sessionCount} > 0`),
        check("course_packages_status_check", sql`${table.status} IN ('draft', 'active', 'closed')`),
        check("course_packages_price_vnd_check", sql`${table.priceVnd} >= 0`),
    ],
);
