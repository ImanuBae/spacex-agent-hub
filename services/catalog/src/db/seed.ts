import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { coursePackages, courses } from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
}

const pool = new pg.Pool({ connectionString });
const db = drizzle(pool);

try {
    await db
        .insert(courses)
        .values({
            code: "OFFICE-BASIC",
            name: "Tin học văn phòng cơ bản",
            description: "Word, Excel, PowerPoint",
            goal: "Sử dụng Office trong công việc",
            level: "beginner",
            deliveryModes: ["onsite", "online"],
            branchIds: [],
            priceVnd: 1500000,
            status: "draft",
        })
        .onConflictDoNothing({ target: courses.code });

    // --- Thêm 3 khóa học nữa ---
    await db
        .insert(courses)
        .values({
            code: "GRAPHIC-DESIGN",
            name: "Thiết kế đồ hoạ với Canva & Photoshop",
            description: "Canva, Photoshop cơ bản, thiết kế banner",
            goal: "Tự thiết kế ấn phẩm truyền thông",
            level: "beginner",
            deliveryModes: ["onsite"],
            branchIds: [],
            priceVnd: 2000000,
            status: "active",
        })
        .onConflictDoNothing({ target: courses.code });

    await db
        .insert(courses)
        .values({
            code: "DATA-ANALYSIS",
            name: "Phân tích dữ liệu với Excel nâng cao",
            description: "Pivot, Power Query, Dashboard",
            goal: "Xử lý và trực quan hóa dữ liệu",
            level: "intermediate",
            deliveryModes: ["onsite", "online"],
            branchIds: [],
            priceVnd: 3000000,
            status: "active",
        })
        .onConflictDoNothing({ target: courses.code });

    await db
        .insert(courses)
        .values({
            code: "WEB-FULLSTACK",
            name: "Lập trình Web Fullstack",
            description: "HTML, CSS, JS, React, Node.js",
            goal: "Xây dựng ứng dụng web hoàn chỉnh",
            level: "advanced",
            deliveryModes: ["online"],
            branchIds: [],
            priceVnd: 5000000,
            status: "draft",
        })
        .onConflictDoNothing({ target: courses.code });

    // --- Query courseId theo code để insert packages ---
    const seedCourses = await db
        .select({ id: courses.id, code: courses.code })
        .from(courses)
        .where(
            sql`${courses.code} IN ('OFFICE-BASIC', 'GRAPHIC-DESIGN', 'DATA-ANALYSIS')`,
        );

    const courseMap = new Map(seedCourses.map((c) => [c.code, c.id]));

    const officeId = courseMap.get("OFFICE-BASIC");
    const graphicId = courseMap.get("GRAPHIC-DESIGN");
    const dataId = courseMap.get("DATA-ANALYSIS");

    if (!officeId || !graphicId || !dataId) {
        throw new Error("Seed courses not found after insert");
    }

    // --- Thêm 3 gói ---
    await db
        .insert(coursePackages)
        .values([
            {
                courseId: officeId,
                code: "OFFICE-12",
                name: "Gói 12 buổi",
                sessionCount: 12,
                priceVnd: 1500000,
                status: "draft",
            },
            {
                courseId: graphicId,
                code: "GRAPHIC-8",
                name: "Gói 8 buổi",
                sessionCount: 8,
                priceVnd: 2000000,
                status: "active",
            },
            {
                courseId: dataId,
                code: "DATA-16",
                name: "Gói 16 buổi chuyên sâu",
                sessionCount: 16,
                priceVnd: 3000000,
                status: "active",
            },
        ])
        .onConflictDoNothing({ target: coursePackages.code });

    console.log("Seed completed: 4 courses, 3 packages");
} finally {
    await pool.end();
}

