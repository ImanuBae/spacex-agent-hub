"use client";
import { useState, type FormEvent } from "react";
import {
  api,
  localTimeInput,
  utcTime,
  type ClassView,
  type Branch,
  type Teacher,
  type Room,
  type Package,
} from "../../../lib/services/classes";
import type { Course } from "../../../lib/services/courses";
import {
  ErrorMessage,
  Field,
  OperationDialog,
} from "../components/OperationUI";
export default function ClassForm({
  current,
  courses,
  packages,
  branches,
  teachers,
  rooms,
  onClose,
  onSaved,
}: {
  current: ClassView | null;
  courses: Course[];
  packages: Package[];
  branches: Branch[];
  teachers: Teacher[];
  rooms: Room[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [courseId, setCourse] = useState(current?.courseId ?? ""),
    [packageId, setPackage] = useState(current?.packageId ?? ""),
    [branchId, setBranch] = useState(current?.branchId ?? ""),
    [mode, setMode] = useState(current?.mode ?? "online");
  const [sessions, setSessions] = useState(
    current?.sessions.map((s) => ({
      startsAt: localTimeInput(s.startsAt),
      endsAt: localTimeInput(s.endsAt),
    })) ?? [{ startsAt: "", endsAt: "" }],
  );
  const [error, setError] = useState<unknown>(null),
    [saving, setSaving] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const input = {
        code: String(f.get("code")),
        name: String(f.get("name")),
        courseId,
        packageId,
        branchId,
        mode,
        teacherId: f.get("teacherId") || null,
        roomId: mode === "onsite" ? f.get("roomId") || null : null,
        onlineUrl: mode === "online" ? f.get("onlineUrl") || null : null,
        capacity: Number(f.get("capacity")),
        minimumSize: Number(f.get("minimumSize")),
        registrationClosesAt: utcTime(String(f.get("registrationClosesAt"))),
        decisionAt: utcTime(String(f.get("decisionAt"))),
        sessions: sessions.map((s) => ({
          startsAt: utcTime(s.startsAt),
          endsAt: utcTime(s.endsAt),
        })),
      };
      await api(
        current ? `classes/${current.id}` : "classes",
        current ? "PUT" : "POST",
        current ? { version: current.version, input } : input,
      );
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }
  const field = (
    name: string,
    label: string,
    type = "text",
    value?: string | number,
  ) => (
    <Field name={name} label={label} error={error}>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={value}
        required
        aria-describedby={`${name}-error`}
        min={type === "number" ? (name === "minimumSize" ? 0 : 1) : undefined}
        max={type === "number" ? 500 : undefined}
      />
    </Field>
  );
  return (
    <OperationDialog
      title={current ? "Sửa lớp và lịch" : "Tạo lớp và lịch"}
      onClose={onClose}
    >
      <p className="muted">
        Giờ Việt Nam · Asia/Ho_Chi_Minh (UTC+7). Lưu trữ UTC.
      </p>
      <form onSubmit={save} className="ops-form">
        {field("code", "Mã lớp", "text", current?.code)}
        {field("name", "Tên lớp", "text", current?.name)}
        <Field name="courseId" label="Khóa học" error={error}>
          <select
            id="courseId"
            value={courseId}
            disabled={!!current}
            required
            onChange={(e) => {
              setCourse(e.target.value);
              setPackage("");
            }}
          >
            <option value="">Chọn khóa đang bán</option>
            {courses
              .filter((c) => c.status === "active" || c.id === courseId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field name="packageId" label="Gói học" error={error}>
          <select
            id="packageId"
            value={packageId}
            disabled={!!current}
            required
            onChange={(e) => setPackage(e.target.value)}
          >
            <option value="">Chọn gói thuộc khóa</option>
            {packages
              .filter(
                (p) =>
                  p.courseId === courseId &&
                  (p.status === "active" || p.id === packageId),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.sessionCount} buổi
                </option>
              ))}
          </select>
        </Field>
        <Field name="branchId" label="Chi nhánh" error={error}>
          <select
            id="branchId"
            value={branchId}
            required
            disabled={!!current}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">Chọn chi nhánh</option>
            {branches
              .filter((b) => b.active && b.kind === "branch")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </Field>
        <Field name="mode" label="Hình thức" error={error}>
          <select
            id="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "online" | "onsite")}
          >
            <option value="online">Online</option>
            <option value="onsite">Tại phòng</option>
          </select>
        </Field>
        <Field name="teacherId" label="Giảng viên" error={error}>
          <select
            key={branchId}
            id="teacherId"
            name="teacherId"
            defaultValue={current?.teacherId ?? ""}
          >
            <option value="">Chưa phân công</option>
            {teachers
              .filter((t) => t.branchId === branchId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <small>Thiếu giảng viên: bổ sung hồ sơ tại Tổ chức.</small>
        </Field>
        {mode === "online" ? (
          field(
            "onlineUrl",
            "Liên kết online (HTTPS)",
            "url",
            current?.onlineUrl ?? "",
          )
        ) : (
          <Field name="roomId" label="Phòng học" error={error}>
            <select
              key={branchId}
              id="roomId"
              name="roomId"
              defaultValue={current?.roomId ?? ""}
            >
              <option value="">Chưa chọn phòng</option>
              {rooms
                .filter((r) => r.branchId === branchId && r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.capacity} chỗ
                  </option>
                ))}
            </select>
            <small>Thiếu phòng: dùng “Thêm phòng” ở danh sách lớp.</small>
          </Field>
        )}
        {field("capacity", "Sức chứa", "number", current?.capacity ?? 20)}
        {field(
          "minimumSize",
          "Sĩ số tối thiểu (demo: 0)",
          "number",
          current?.minimumSize ?? 0,
        )}
        {field(
          "registrationClosesAt",
          "Hạn đăng ký · UTC+7",
          "datetime-local",
          current ? localTimeInput(current.registrationClosesAt) : "",
        )}
        {field(
          "decisionAt",
          "Hạn quyết định · UTC+7",
          "datetime-local",
          current ? localTimeInput(current.decisionAt) : "",
        )}
        <section className="span">
          <h3>Buổi học · UTC+7</h3>
          <p className="muted">Cần đủ số buổi của gói trước khi OPEN.</p>
          {sessions.map((s, i) => (
            <div className="ops-session" key={i}>
              <Field
                name={`sessions.${i}.startsAt`}
                label={`Buổi ${i + 1} · bắt đầu`}
                error={error}
              >
                <input
                  id={`sessions.${i}.startsAt`}
                  type="datetime-local"
                  required
                  value={s.startsAt}
                  onChange={(e) =>
                    setSessions((v) =>
                      v.map((s, j) =>
                        j === i ? { ...s, startsAt: e.target.value } : s,
                      ),
                    )
                  }
                />
              </Field>
              <Field
                name={`sessions.${i}.endsAt`}
                label={`Buổi ${i + 1} · kết thúc`}
                error={error}
              >
                <input
                  id={`sessions.${i}.endsAt`}
                  type="datetime-local"
                  required
                  value={s.endsAt}
                  onChange={(e) =>
                    setSessions((v) =>
                      v.map((s, j) =>
                        j === i ? { ...s, endsAt: e.target.value } : s,
                      ),
                    )
                  }
                />
              </Field>
              <button
                type="button"
                aria-label={`Xóa buổi ${i + 1}`}
                onClick={() => setSessions((v) => v.filter((_, j) => i !== j))}
              >
                Xóa
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={sessions.length >= 100}
            onClick={() =>
              setSessions((v) => [...v, { startsAt: "", endsAt: "" }])
            }
          >
            Thêm buổi
          </button>
        </section>
        <div className="span">
          <ErrorMessage error={error} />
        </div>
        <div className="ops-actions span">
          <button className="primary" disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu lớp và lịch"}
          </button>
          <button type="button" onClick={onClose} disabled={saving}>
            Hủy
          </button>
        </div>
      </form>
    </OperationDialog>
  );
}
