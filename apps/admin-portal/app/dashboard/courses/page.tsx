"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../src/context/AuthContext";
import { getMenuByRole } from "../../../lib/roles";
import { allPages, api, money, type Branch, type Package } from "../../../lib/services/classes";
import { courseService, type Course, type CourseInput } from "../../../lib/services/courses";
import { ErrorMessage, Field } from "../components/OperationUI";
import CourseModal from "./CourseModal";
import PackagesPanel from "./PackagesPanel";
import CatalogSearch, { OfferHistory, courseLevels, courseModes, offerStatuses } from "./CatalogSearch";
import "./courses.css";

const searchable = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");

export default function CoursesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "center_director";
  const canEnroll = user && getMenuByRole(user.role).some(item => item.href === "/dashboard/enrollments");
  const [courses, setCourses] = useState<Course[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true), [loadingPackages, setLoadingPackages] = useState(true);
  const [error, setError] = useState<unknown>(), [packageError, setPackageError] = useState<unknown>();
  const [search, setSearch] = useState(""), [level, setLevel] = useState(""), [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Course | null>(), [historyId, setHistoryId] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rows, branchResponse] = await Promise.all([courseService.getAllCourses(), api<Branch[]>("branches")]);
      setCourses(rows); setBranches(branchResponse.data);
    } catch (failure) { setError(failure); }
    finally { setLoading(false); }
  }, []);
  const loadPackages = useCallback(async () => {
    setLoadingPackages(true); setPackageError(null);
    try { setPackages(await allPages<Package>("packages")); }
    catch (failure) { setPackageError(failure); }
    finally { setLoadingPackages(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadPackages();
  }, [load, loadPackages]);

  async function save(form: CourseInput) {
    if (editing) {
      const updated = await courseService.updateCourse(editing.id, form);
      setCourses(current => current.map(row => row.id === updated.id ? updated : row));
    } else {
      const created = await courseService.createCourse(form);
      setCourses(current => [created, ...current]);
    }
  }
  const query = searchable(search.trim());
  const filtered = courses.filter(row => (!level || row.level === level) && (!status || row.status === status)
    && (searchable(row.name).includes(query) || searchable(row.code).includes(query)));

  return <div className="ops catalog-page">
    <header className="ops-heading">
      <h1>Khóa học &amp; Gói</h1>
      {canEdit && <button className="primary" type="button" disabled={loading} onClick={() => setEditing(null)}>Thêm khóa học mới</button>}
    </header>
    <section className="ops-panel" aria-labelledby="catalog-courses-title">
      <div className="ops-heading"><h2 id="catalog-courses-title">Danh sách khóa học</h2></div>
      <div className="ops-filters">
        <Field name="course-search" label="Tên hoặc mã khóa học">
          <input id="course-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </Field>
        <Field name="course-level" label="Trình độ">
          <select id="course-level" value={level} onChange={event => setLevel(event.target.value)}>
            <option value="">Tất cả trình độ</option>
            {Object.entries(courseLevels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field name="course-status" label="Trạng thái">
          <select id="course-status" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Tất cả trạng thái</option>
            {Object.entries(offerStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      <div aria-busy={loading}>
        <ErrorMessage error={error} retry={() => void load()} />
        {loading ? <p role="status">Đang tải khóa học…</p> : !error && <>
          <p className="catalog-count muted" role="status">{filtered.length} / {courses.length} khóa học</p>
          {!filtered.length && <p>{courses.length ? "Không tìm thấy khóa học phù hợp." : "Chưa có khóa học."}</p>}
          <ul className="catalog-courses">
            {filtered.map(row => {
              const related = packages.filter(pkg => pkg.courseId === row.id);
              return <li key={row.id} className="catalog-course">
              <div>
                <h3>{row.name}</h3>
                <p className="muted">{row.code} · {courseLevels[row.level]} · {row.deliveryModes.map(mode => courseModes[mode]).join(" / ")}</p>
                {row.description && <p>{row.description}</p>}
              </div>
              <div className="catalog-price"><strong>{money(row.priceVnd)}</strong><p className="status" data-status={row.status}>{offerStatuses[row.status]}</p></div>
              <div>
                <p className="muted">Gói học</p>
                {loadingPackages ? <p>Đang tải gói…</p> : packageError ? <a href="#course-packages">Xem lỗi tải gói</a>
                  : related.length
                    ? <ul>{related.map(pkg => <li key={pkg.id}>
                      <strong>{pkg.name}</strong><p className="muted">{pkg.sessionCount} buổi · {money(pkg.priceVnd)} · {offerStatuses[pkg.status]}</p>
                      {canEnroll && row.status === "active" && pkg.status === "active" &&
                        <Link className="ops-link" href={`/dashboard/enrollments?package=${pkg.id}`}>Tìm lớp<span className="sr-only"> {row.name} · {pkg.name}</span></Link>}
                    </li>)}</ul>
                    : <p>Chưa có gói.</p>}
              </div>
              <div className="ops-actions">
                <button type="button" onClick={() => setHistoryId(row.id)}>Xem lịch sử<span className="sr-only"> của {row.name}</span></button>
                {canEdit && <button type="button" onClick={() => setEditing(row)}>Sửa<span className="sr-only"> {row.name}</span></button>}
              </div>
            </li>;
            })}
          </ul>
        </>}
      </div>
    </section>
    <CatalogSearch courses={courses} branches={branches} />
    <PackagesPanel courses={courses} canEdit={canEdit} packages={packages} loading={loadingPackages} error={packageError} load={loadPackages} />
    {editing !== undefined && <CourseModal key={editing?.id ?? "new"} onClose={() => setEditing(undefined)} onSubmit={save} initialData={editing} />}
    {historyId && <OfferHistory resource="courses" id={historyId} onClose={() => setHistoryId(undefined)} />}
  </div>;
}
