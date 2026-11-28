"use client";
import { useState, type FormEvent } from "react";
import {
  api,
  money,
  dateTime,
  type Package,
} from "../../../lib/services/classes";
import type { Course } from "../../../lib/services/courses";
import {
  ErrorMessage,
  Field,
  OperationDialog,
} from "../components/OperationUI";
import "../components/operations.css";
import { OfferHistory, offerStatuses } from "./CatalogSearch";
export default function PackagesPanel({
  courses,
  canEdit,
  packages,
  loading,
  error,
  load,
}: {
  courses: Course[];
  canEdit: boolean;
  packages: Package[];
  loading: boolean;
  error: unknown;
  load: () => Promise<void>;
}) {
  const [formError, setFormError] = useState<unknown>(null),
    [saving, setSaving] = useState(false),
    [editing, setEditing] = useState<Package | null | undefined>(undefined),
    [courseFilter, setCourseFilter] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    setFormError(null);
    try {
      await api(
        editing ? `packages/${editing.id}` : "packages",
        editing ? "PUT" : "POST",
        {
          courseId: f.get("courseId"),
          code: f.get("code"),
          name: f.get("name"),
          sessionCount: Number(f.get("sessionCount")),
          policyText: f.get("policyText"),
          priceVnd: Number(f.get("priceVnd")),
          status: f.get("status"),
        },
      );
      setEditing(undefined);
      await load();
    } catch (e) {
      setFormError(e);
    } finally {
      setSaving(false);
    }
  }
  const filtered = packages.filter(
    (p) => !courseFilter || p.courseId === courseFilter,
  );
  return (
    <section className="ops-panel" id="course-packages" aria-busy={loading}>
      <div className="ops-heading">
        <div>
          <h2>Gói học</h2>
        </div>
        <div className="ops-actions">
          <button disabled={loading} onClick={() => void load()}>
            Làm mới gói
          </button>
          {canEdit && (
            <button
              className="primary"
              disabled={!courses.length}
              onClick={() => {
                setFormError(null);
                setEditing(null);
              }}
            >
              Thêm gói học
            </button>
          )}
        </div>
      </div>
      <Field name="package-course-filter" label="Gói theo khóa">
        <select
          id="package-course-filter"
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
        >
          <option value="">Tất cả khóa học</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <ErrorMessage error={error} retry={() => void load()} />
      {loading ? (
        <p role="status">Đang tải gói học…</p>
      ) : !error && <>
        <p className="catalog-count muted" role="status">{filtered.length} gói học</p>
        {!filtered.length && <p>Chưa có gói phù hợp.</p>}
        <ul className="catalog-courses">
          {filtered.map(p => <li className="catalog-course" key={p.id}>
            <div>
              <h3>{p.name}</h3>
              <p>{courses.find(c => c.id === p.courseId)?.name ?? "—"}</p>
              <p className="muted">{p.code} · {p.sessionCount} buổi</p>
            </div>
            <div className="catalog-price"><strong>{money(p.priceVnd)}</strong><p className="status">{offerStatuses[p.status]}</p></div>
            <div><p>Phiên bản {p.policyVersion}</p><p className="muted">Hiệu lực {dateTime(p.effectiveAt)}</p></div>
            <div className="ops-actions">
              <button onClick={() => setHistoryId(p.id)}>Xem lịch sử<span className="sr-only"> gói {p.code}</span></button>
              {canEdit && <button onClick={() => { setFormError(null); setEditing(p); }}>Sửa gói<span className="sr-only"> {p.code}</span></button>}
            </div>
          </li>)}
        </ul>
      </>}
      {editing !== undefined && (
        <OperationDialog
          title={editing ? "Sửa gói học" : "Thêm gói học"}
          onClose={() => setEditing(undefined)}
        >
          <form onSubmit={save} className="ops-form">
            <Field name="courseId" label="Khóa học" error={formError}>
              <select
                id="courseId"
                name="courseId"
                required
                defaultValue={editing?.courseId ?? courseFilter}
              >
                <option value="">Chọn khóa</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {(
              [
                ["code", "Mã gói", "text"],
                ["name", "Tên gói", "text"],
                ["sessionCount", "Số buổi", "number"],
                ["priceVnd", "Giá VND", "number"],
              ] as const
            ).map(([name, label, type]) => (
              <Field key={name} name={name} label={label} error={formError}>
                <input
                  id={name}
                  name={name}
                  required
                  type={type}
                  min={name === "priceVnd" ? 0 : 1}
                  step={type === "number" ? 1 : undefined}
                  max={
                    name === "priceVnd" ? Number.MAX_SAFE_INTEGER : undefined
                  }
                  defaultValue={editing?.[name] ?? ""}
                  aria-describedby={`${name}-error`}
                />
              </Field>
            ))}
            <Field name="status" label="Trạng thái" error={formError}>
              <select
                id="status"
                name="status"
                defaultValue={editing?.status ?? "draft"}
              >
                <option value="draft">Nháp</option>
                <option value="active">Đang bán</option>
                <option value="closed">Ngừng bán</option>
              </select>
            </Field>
            <div className="span"><Field name="policyText" label="Chính sách gói học" error={formError}><textarea id="policyText" name="policyText" rows={3} maxLength={10000} defaultValue={editing?.policyText ?? ""} /></Field><p className="muted">Lưu sẽ tạo phiên bản có hiệu lực ngay, giữ nguyên lịch sử trước đó.</p></div>
            <div className="span">
              <ErrorMessage error={formError} />
              <button className="primary" disabled={saving}>
                {saving ? "Đang lưu…" : "Lưu gói học"}
              </button>
            </div>
          </form>
        </OperationDialog>
      )}
      {historyId && <OfferHistory resource="packages" id={historyId} onClose={() => setHistoryId(null)} />}
    </section>
  );
}
