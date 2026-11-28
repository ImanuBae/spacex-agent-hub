"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { PublicClass, PublicOffer } from "@spacex/contracts";
import { dateTime, money } from "../../lib/services/classes";
import CourseCover from "./CourseCover";
import { levels, modes } from "./course-previews";

const categories = ["Tất cả", "Lập trình", "Dữ liệu", "Thiết kế"] as const;
const courseCategories = {
  "DEMO-PYTHON": "Lập trình",
  "DEMO-SQL": "Dữ liệu",
  "DEMO-POWER-BI": "Dữ liệu",
  "DEMO-FIGMA": "Thiết kế",
} as Record<string, (typeof categories)[number]>;
const searchText = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");

export default function DemoCatalog({ catalog, nextClasses }: { catalog: PublicOffer[]; nextClasses: Record<string, PublicClass | null> }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("Tất cả");
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const normalized = searchText(query.trim());
  const offers = catalog.filter(offer =>
    (category === "Tất cả" || courseCategories[offer.courseCode] === category) &&
    searchText(`${offer.courseName} ${offer.packageName} ${offer.courseCode} ${offer.packageCode}`).includes(normalized)
  ).sort((a, b) => Number(Boolean(nextClasses[b.packageId])) - Number(Boolean(nextClasses[a.packageId])));

  function resetFilters() {
    setQuery("");
    setCategory("Tất cả");
    resultsHeading.current?.focus();
  }

  return (
    <div className="public-frame course-content">
      <section aria-labelledby="course-results">
        <div className="course-results">
          <h2 id="course-results" ref={resultsHeading} tabIndex={-1}>
            Danh mục khóa học
          </h2>
          <p role="status">{offers.length} gói học</p>
        </div>
        <div className="course-toolbar">
          <div className="course-filters" role="group" aria-label="Lọc theo chủ đề">
            {categories.map(item => (
              <button
                key={item}
                type="button"
                aria-pressed={item === category}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="course-search">
            <span className="sr-only">Tìm theo tên, mã khóa hoặc mã gói</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              maxLength={100}
              placeholder="Tìm theo tên hoặc mã"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </label>
        </div>
        {offers.length ? (
          <ul className="course-grid" role="list">
            {offers.map(offer => {
              const next = nextClasses[offer.packageId];
              return (
                <li key={offer.packageId}>
                  <article className="course-card">
                    <CourseCover code={offer.courseCode} />
                    <div className="course-card-body">
                      <p className="course-mode">{levels[offer.level] ?? offer.level} · {offer.deliveryModes.map(mode => modes[mode] ?? mode).join(" / ")}</p>
                      <h3>{offer.courseName}</h3>
                      <p className="course-package">{offer.packageName}</p>
                      <div className="course-fee">
                        <strong>{money(offer.priceVnd)}</strong>
                        <span>{offer.sessionCount} buổi</span>
                      </div>
                      {next?.startsAt && <p className="course-next">Khai giảng {dateTime(next.startsAt)} · Còn {next.availableSeats} chỗ</p>}
                      <Link className="course-detail-link" href={`/khoa-hoc/${offer.packageId}`}>Xem chi tiết<span className="sr-only"> {offer.packageName}</span><span aria-hidden="true">↗</span></Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : <p className="course-empty">{catalog.length ? "Không tìm thấy khóa học phù hợp với bộ lọc." : "Chưa có khóa học công khai."}</p>}
        {!offers.length && !!catalog.length && (
          <button type="button" className="btn btn-outline course-reset" onClick={resetFilters}>Xem tất cả gói</button>
        )}
      </section>
    </div>
  );
}
