CREATE TABLE "course_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"session_count" integer NOT NULL,
	"price_vnd" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_packages_code_unique" UNIQUE("code"),
	CONSTRAINT "course_packages_session_count_check" CHECK ("course_packages"."session_count" > 0),
	CONSTRAINT "course_packages_status_check" CHECK ("course_packages"."status" IN ('draft', 'active', 'closed')),
	CONSTRAINT "course_packages_price_vnd_check" CHECK ("course_packages"."price_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"goal" varchar(500) NOT NULL,
	"level" varchar(20) NOT NULL,
	"delivery_modes" text[] NOT NULL,
	"branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"price_vnd" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_code_unique" UNIQUE("code"),
	CONSTRAINT "courses_level_check" CHECK ("courses"."level" IN ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT "courses_status_check" CHECK ("courses"."status" IN ('draft', 'active', 'closed')),
	CONSTRAINT "courses_price_vnd_check" CHECK ("courses"."price_vnd" >= 0),
	CONSTRAINT "courses_delivery_modes_check" CHECK (cardinality("courses"."delivery_modes") >= 1 AND "courses"."delivery_modes" <@ ARRAY['onsite', 'online']::text[])
);
--> statement-breakpoint
ALTER TABLE "course_packages" ADD CONSTRAINT "course_packages_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;