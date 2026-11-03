"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  allPages,
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
import { OfferHistory } from "./CatalogSearch";
export default function PackagesPanel({
  courses,
  canEdit,
}: {
  courses: Course[];
  canEdit: boolean;
}) {
  const [packages, setPackages] = useState<Package[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(null),
    [formError, setFormError] = useState<unknown>(null),
    [saving, setSaving] = useState(false),
    [editing, setEditing] = useState<Package | null | undefined>(undefined),
    [courseFilter, setCourseFilter] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPackages(await allPages<Package>("packages"));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  // Synchronize this view with the remote Catalog, including its loading state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
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
    <section className="ops ops-panel">
      <div className="ops-heading">
        <div>
          <h2>Gói học</h2>
          <p className="muted">
            Giá VND và số buổi từ Catalog.{" "}
            {canEdit
              ? "Chính sách có lịch sử phiên bản."
              : "Chỉ giám đốc trung tâm được sửa."}
          </p>
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
      ) : error ? (
        <p>Chưa xác minh được gói học.</p>
      ) : !filtered.length ? (
        <p>
          Chưa có gói phù hợp.{" "}
          {canEdit
            ? "Tạo khóa rồi thêm gói học."
            : "Liên hệ giám đốc trung tâm để bổ sung."}
        </p>
      ) : (
        <div className="ops-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên / Mã gói</th>
                <th>Khóa học</th>
                <th className="num">Số buổi</th>
                <th className="num">Giá VND</th>
                <th>Trạng thái</th>
                <th>Phiên bản / Hiệu lực</th>
                {canEdit && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <p className="muted">{p.code}</p>
                  </td>
                  <td>
                    {courses.find((c) => c.id === p.courseId)?.name ?? "—"}
                  </td>
                  <td className="num">{p.sessionCount}</td>
                  <td className="num">{money(p.priceVnd)}</td>
                  <td>
                    <span className="status">{p.status}</span>
                  </td>
                  <td>
                    {p.policyVersion}
                    <p className="muted">{dateTime(p.effectiveAt)}</p>
                    <button onClick={() => setHistoryId(p.id)}>Xem lịch sử</button>
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        onClick={() => {
                          setFormError(null);
                          setEditing(p);
                        }}
                      >
                        Sửa gói
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        {filtered.length} gói theo bộ lọc · dữ liệu đã tải toàn bộ trang.
      </p>
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
