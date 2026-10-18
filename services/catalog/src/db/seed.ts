import { eq } from "drizzle-orm";
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

    const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.code, "OFFICE-BASIC"));
    if (!course) {
        throw new Error("Seed course OFFICE-BASIC not found");
    }

    await db
        .insert(coursePackages)
        .values({
            courseId: course.id,
            code: "OFFICE-12",
            name: "Gói 12 buổi",
            sessionCount: 12,
            priceVnd: 1500000,
            status: "draft",
        })
        .onConflictDoNothing({ target: coursePackages.code });

    console.log("Seed completed");
} finally {
    await pool.end();
}
