"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAuth } from "../../../src/context/AuthContext";
import {
  api,
  allPages,
  dateTime,
  utcTime,
  type ClassView,
  type HoldView,
  type Branch,
  type Teacher,
  type Room,
  type Package,
  type DemoFixture,
} from "../../../lib/services/classes";
import type { Course } from "../../../lib/services/courses";
import {
  ErrorMessage,
  Field,
  OperationDialog,
} from "../components/OperationUI";
import ClassForm from "./ClassForm";
import "../components/operations.css";
export default function SchedulePage() {
  const { user } = useAuth(),
    manager = ["center_director", "branch_director"].includes(user?.role ?? ""),
    canHold = ["center_director", "branch_director", "admissions"].includes(
      user?.role ?? "",
    );
  const [courses, setCourses] = useState<Course[]>([]),
    [packages, setPackages] = useState<Package[]>([]),
    [branches, setBranches] = useState<Branch[]>([]),
    [teachers, setTeachers] = useState<Teacher[]>([]),
    [rooms, setRooms] = useState<Room[]>([]);
  const [rows, setRows] = useState<ClassView[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState({
      courseId: "",
      packageId: "",
      branchId: "",
      mode: "",
      status: "",
      from: "",
      to: "",
      sellable: "false",
      sort: "code",
    });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(null),
    [referenceError, setReferenceError] = useState<unknown>(null),
    [referencesLoading, setReferencesLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ClassView | null>(null),
    [form, setForm] = useState<"new" | "edit" | null>(null),
    [roomForm, setRoomForm] = useState(false);
  const [lifecycle, setLifecycle] = useState<"CANCELLED" | "IN_PROGRESS" | "COMPLETED" | null>(null);
  const [demo, setDemo] = useState<{
      enabled: boolean;
      ttlSeconds: number;
      fixtures: DemoFixture[];
    }>({ enabled: false, ttlSeconds: 1200, fixtures: [] }),
    [fixture, setFixture] = useState("");
  const [holds, setHolds] = useState<HoldView[]>([]),
    [holdError, setHoldError] = useState<unknown>(null),
    [holdsLoading, setHoldsLoading] = useState(false),
    [cancel, setCancel] = useState<HoldView | null>(null),
    [now, setNow] = useState(0),
    [offset, setOffset] = useState(0);
  const intent = useRef<{ signature: string; key: string } | null>(null),
    requestId = useRef(0),
    selectedId = useRef<string | null>(null);
  const loadReferences = useCallback(async () => {
    setReferencesLoading(true);
    setReferenceError(null);
    try {
      const [c, p, b, t, r] = await Promise.all([
        allPages<Course>("courses"),
        allPages<Package>("packages"),
        api<Branch[]>("branches"),
        api<Teacher[]>("teachers"),
        api<Room[]>("rooms"),
      ]);
      setCourses(c);
      setPackages(p);
      setBranches(b.data);
      setTeachers(t.data);
      setRooms(r.data);
      if (canHold)
        setDemo(
          (
            await api<{
              enabled: boolean;
              ttlSeconds: number;
              fixtures: DemoFixture[];
            }>("hold-fixtures")
          ).data,
        );
    } catch (e) {
      setReferenceError(e);
    } finally {
      setReferencesLoading(false);
    }
  }, [canHold]);
  const load = useCallback(async () => {
    const generation = ++requestId.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    for (const [k, v] of Object.entries(filter))
      if (v) query.set(k, ["from", "to"].includes(k) ? utcTime(v) : v);
    try {
      const r = await api<ClassView[]>(`classes?${query}`);
      if (generation !== requestId.current) return;
      setRows(r.data);
      setTotal(r.pagination?.total ?? 0);
      if (selectedId.current) {
        const detail = await api<ClassView>(`classes/${selectedId.current}`);
        if (generation === requestId.current) setSelected(detail.data);
      }
    } catch (e) {
      if (generation === requestId.current) setError(e);
    } finally {
      if (generation === requestId.current) setLoading(false);
    }
  }, [page, filter]);
  const loadHolds = useCallback(async () => {
    if (!canHold) return;
    setHoldsLoading(true);
    setHoldError(null);
    try {
      const r = await api<HoldView[]>("holds");
      setHolds(r.data);
      if (r.data[0]) setOffset(Date.parse(r.data[0].serverTime) - Date.now());
    } catch (e) {
      setHoldError(e);
    } finally {
      setHoldsLoading(false);
    }
  }, [canHold]);
  // These effects synchronize API resources and their visible loading/error states.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReferences();
  }, [loadReferences]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHolds();
  }, [loadHolds]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void load();
        void loadHolds();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load, loadHolds]);
  const due = holds.some(
    (h) => h.status === "HELD" && Date.parse(h.expiresAt) <= now + offset,
  );
  // Expiry requires server confirmation; never turn the browser's countdown into a state transition.
  useEffect(() => {
    if (!due) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHolds();
    void load();
    const retry = setInterval(() => void loadHolds(), 5000);
    return () => clearInterval(retry);
  }, [due, loadHolds, load]);
  const refresh = async () => {
    await Promise.all([load(), loadHolds()]);
  };
  const label = (items: { id: string; name: string }[], id: string | null) =>
    items.find((i) => i.id === id)?.name ?? "—";
  async function transition(status: "PLANNED" | "OPEN" | "CANCELLED" | "IN_PROGRESS" | "COMPLETED", reason = "") {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setSelected(
        (
          await api<ClassView>(`classes/${selected.id}/status`, "POST", {
            status,
            version: selected.version,
            reason,
          })
        ).data,
      );
      await load();
      setLifecycle(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function hold() {
    const f = demo.fixtures.find((f) => f.id === fixture);
    if (!selected || !f) return;
    const payload = {
        classId: selected.id,
        packageId: selected.packageId,
        learnerId: f.learnerId,
        enrollmentId: f.enrollmentId,
      },
      signature = JSON.stringify(payload),
      storageKey = `class-hold-intent:${user?.id ?? ""}`;
    try {
      if (!intent.current) {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) intent.current = JSON.parse(saved);
      }
      const terminal = holds.some(
        (h) =>
          h.operationKey === intent.current?.key &&
          ["CANCELLED", "EXPIRED"].includes(h.status),
      );
      if (intent.current?.signature !== signature || terminal)
        intent.current = { signature, key: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(intent.current));
    } catch {
      if (intent.current?.signature !== signature)
        intent.current = { signature, key: crypto.randomUUID() };
    }
    setBusy(true);
    setHoldError(null);
    try {
      const r = await api<HoldView>(
        "holds",
        "POST",
        payload,
        intent.current!.key,
      );
      setOffset(Date.parse(r.data.serverTime) - Date.now());
      setHolds((v) => [r.data, ...v.filter((h) => h.id !== r.data.id)]);
      await load();
    } catch (e) {
      setHoldError(e);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function cancelHold() {
    if (!cancel) return;
    setBusy(true);
    setHoldError(null);
    try {
      await api(`holds/${cancel.id}/cancel`, "POST", {});
      setCancel(null);
      intent.current = null;
      sessionStorage.removeItem(`class-hold-intent:${user?.id ?? ""}`);
      await refresh();
    } catch (e) {
      setHoldError(e);
    } finally {
      setBusy(false);
    }
  }
  async function createRoom(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("rooms", "POST", {
        branchId: d.get("branchId"),
        name: d.get("name"),
        capacity: Number(d.get("capacity")),
      });
      setRoomForm(false);
      await loadReferences();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const updateFilter = (key: keyof typeof filter, value: string) => {
    setFilter((v) => ({
      ...v,
      [key]: value,
      ...(key === "courseId" ? { packageId: "" } : {}),
    }));
    setPage(1);
  };
  const reason = !canHold
    ? "Vai trò chỉ được xem lớp."
    : !demo.enabled
      ? "Chưa tích hợp Enrollment; demo fixture đang tắt."
      : !selected
        ? "Chọn lớp."
        : selected.status !== "OPEN"
          ? "Lớp chưa OPEN."
          : Date.parse(selected.registrationClosesAt) <=
              Date.parse(selected.serverTime)
            ? "Đã hết hạn đăng ký."
            : selected.available <= 0
              ? "Lớp đã hết chỗ."
              : !fixture
                ? "Chọn học viên demo đã seed."
                : "";
  const selectFilter = (
    key: keyof typeof filter,
    title: string,
    options: { id: string; name: string }[],
  ) => (
    <Field name={`filter-${key}`} label={title}>
      <select
        id={`filter-${key}`}
        value={filter[key]}
        onChange={(e) => updateFilter(key, e.target.value)}
      >
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="ops">
      <div className="ops-heading">
        <div>
          <h1>Lớp học và lịch</h1>
          <p className="muted">
            {user?.role === "teacher"
              ? "Lớp được phân công của bạn."
              : "Lịch mở bán và số chỗ theo chi nhánh."}{" "}
            Giờ Việt Nam · UTC+7.
          </p>
        </div>
        <div className="ops-actions">
          <button onClick={() => void refresh()} disabled={loading}>
            Làm mới
          </button>
          {manager && (
            <button
              className="primary"
              disabled={referencesLoading || !!referenceError}
              onClick={() => setForm("new")}
            >
              Tạo lớp
            </button>
          )}
        </div>
      </div>
      <ErrorMessage
        error={referenceError}
        retry={() => void loadReferences()}
      />
      {referencesLoading && (
        <p role="status">
          Đang tải dữ liệu khóa/gói, chi nhánh, giảng viên và phòng…
        </p>
      )}
      <details className="ops-panel">
        <summary>Lọc lớp theo khóa, chi nhánh và thời gian</summary>
        <div className="ops-filters">
          {selectFilter("courseId", "Khóa học", courses)}
          {selectFilter(
            "packageId",
            "Gói học",
            packages.filter(
              (p) => !filter.courseId || p.courseId === filter.courseId,
            ),
          )}
          {selectFilter(
            "branchId",
            "Chi nhánh",
            branches.filter((b) => b.kind === "branch"),
          )}
          {selectFilter("mode", "Hình thức", [
            { id: "online", name: "Online" },
            { id: "onsite", name: "Tại phòng" },
          ])}
          {selectFilter(
            "status",
            "Trạng thái",
            ["DRAFT", "PLANNED", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => ({ id: s, name: s })),
          )}
          <Field name="filter-sellable" label="Tra cứu tuyển sinh">
            <select
              id="filter-sellable"
              value={filter.sellable}
              onChange={(e) => updateFilter("sellable", e.target.value)}
            >
              <option value="false">Danh sách quản lý</option>
              <option value="true">OPEN còn chỗ, còn hạn</option>
            </select>
          </Field>
          {(["from", "to"] as const).map((k) => (
            <Field
              key={k}
              name={`filter-${k}`}
              label={`${k === "from" ? "Buổi từ" : "Buổi đến"} · UTC+7`}
            >
              <input
                id={`filter-${k}`}
                type="datetime-local"
                value={filter[k]}
                onChange={(e) => updateFilter(k, e.target.value)}
              />
            </Field>
          ))}
          <Field name="filter-sort" label="Sắp xếp">
            <select
              id="filter-sort"
              value={filter.sort}
              onChange={(e) => updateFilter("sort", e.target.value)}
            >
              <option value="code">Mã lớp</option>
              <option value="registrationClosesAt">Hạn đăng ký</option>
            </select>
          </Field>
        </div>
      </details>
      <section className="ops-panel">
        <div className="ops-heading">
          <h2>Danh sách lớp</h2>
          <span className="muted">
            {loading ? "Đang tải…" : error ? "Chưa xác minh số lớp" : `${total} lớp theo bộ lọc`}
          </span>
          {manager && (
            <button
              onClick={() => {
                setError(null);
                setRoomForm(true);
              }}
            >
              Thêm phòng
            </button>
          )}
        </div>
        <ErrorMessage error={error} retry={() => void load()} />
        {loading ? (
          <p role="status">Đang đọc lịch và chỗ từ server…</p>
        ) : error ? (
          <p>Chưa xác minh được danh sách. Hãy thử lại.</p>
        ) : !rows.length ? (
          <p>
            Chưa có lớp phù hợp.{" "}
            {manager
              ? "Tạo lớp từ khóa/gói đang hoạt động."
              : "Thử bộ lọc khác hoặc liên hệ giám đốc chi nhánh."}
          </p>
        ) : (
          <div className="ops-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lớp / Gói</th>
                  <th>Chi nhánh / Lịch đầu</th>
                  <th>Trạng thái</th>
                  {["Sức chứa", "Đã chốt", "Đang giữ", "Còn chỗ"].map((h) => (
                    <th key={h} className="num">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button
                        className="ops-name"
                        onClick={() => {
                          selectedId.current = r.id;
                          setSelected(r);
                          setFixture("");
                          setError(null);
                        }}
                      >
                        {r.name}
                      </button>
                      <p className="muted">
                        {r.code} · {label(packages, r.packageId)}
                      </p>
                      <p className="ops-narrow seat">
                        Còn {r.available} / {r.capacity} chỗ
                      </p>
                    </td>
                    <td>
                      {label(branches, r.branchId)}
                      <p className="muted">
                        {r.sessions[0]
                          ? dateTime(r.sessions[0].startsAt)
                          : "Chưa xếp lịch"}
                      </p>
                    </td>
                    <td>
                      <span className="status">{r.status}</span>
                    </td>
                    {[r.capacity, r.committed, r.held, r.available].map(
                      (n, i) => (
                        <td className={`num ${i === 3 ? "seat" : ""}`} key={i}>
                          {n}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 20 && (
          <div className="ops-actions">
            <button
              disabled={page === 1 || loading}
              onClick={() => setPage((v) => v - 1)}
            >
              Trước
            </button>
            <span>
              Trang {page} / {Math.ceil(total / 20)}
            </span>
            <button
              disabled={page * 20 >= total || loading}
              onClick={() => setPage((v) => v + 1)}
            >
              Sau
            </button>
          </div>
        )}
      </section>
      {selected && (
        <section className="ops-panel">
          <div className="ops-heading">
            <h2>{selected.name}</h2>
            {manager && (
              <button disabled={busy} onClick={() => setForm("edit")}>
                Sửa lớp và lịch
              </button>
            )}
          </div>
          <div className="ops-detail-grid">
            <div>
              <dl>
                <dt>Gói</dt>
                <dd>{label(packages, selected.packageId)}</dd>
                <dt>Giảng viên</dt>
                <dd>{label(teachers, selected.teacherId)}</dd>
                <dt>Hình thức</dt>
                <dd>
                  {selected.mode === "online"
                    ? "Online"
                    : label(rooms, selected.roomId)}
                </dd>
                <dt>Hạn đăng ký</dt>
                <dd>{dateTime(selected.registrationClosesAt)}</dd>
                <dt>Hạn quyết định</dt>
                <dd>{dateTime(selected.decisionAt)}</dd>
                <dt>Đọc lúc</dt>
                <dd>{dateTime(selected.serverTime)}</dd>
              </dl>
              <h3>Lịch học · UTC+7</h3>
              {selected.sessions.length ? (
                selected.sessions.map((s, i) => (
                  <p key={s.startsAt}>
                    Buổi {i + 1}: {dateTime(s.startsAt)} – {dateTime(s.endsAt)}
                  </p>
                ))
              ) : (
                <p>Chưa có buổi học.</p>
              )}
            </div>
            <div>
              <h3>Điều kiện mở bán</h3>
              {selected.missingConditions.length ? (
                <ul>
                  {selected.missingConditions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  Đủ lịch, giảng viên và phòng/online; backend kiểm tra lại khi
                  duyệt.
                </p>
              )}
              {manager && selected.status === "DRAFT" && (
                <button
                  disabled={busy}
                  onClick={() => void transition("PLANNED")}
                >
                  Chuyển PLANNED
                </button>
              )}
              {user?.role === "branch_director" &&
                selected.status === "PLANNED" && (
                  <button
                    disabled={busy || !!selected.missingConditions.length}
                    aria-describedby="open-reason"
                    onClick={() => void transition("OPEN")}
                  >
                    Duyệt OPEN
                  </button>
                )}
              <p id="open-reason" className="muted">
                Giám đốc chi nhánh duyệt OPEN. Sĩ số tối thiểu lớn hơn 0: chờ
                chính sách C02/CS-7.
              </p>
              <div className="ops-actions">
                {user?.role === "branch_director" && selected.status === "OPEN" && <button disabled={busy} onClick={() => setLifecycle("IN_PROGRESS")}>Bắt đầu lớp</button>}
                {user?.role === "branch_director" && selected.status === "IN_PROGRESS" && <button disabled={busy} onClick={() => setLifecycle("COMPLETED")}>Hoàn tất lớp</button>}
                {manager && ["DRAFT", "PLANNED", "OPEN"].includes(selected.status) && <button disabled={busy || selected.committed > 0} onClick={() => setLifecycle("CANCELLED")}>Hủy lớp</button>}
              </div>
              {manager && selected.committed > 0 && <p className="muted">Lớp đã chốt chỗ cần quy trình Enrollment để hoàn hoặc chuyển trước khi hủy.</p>}
              {canHold && (
                <>
                  <h3>Giữ chỗ kỹ thuật</h3>
                  <p className="muted">
                    {demo.enabled
                      ? `DEMO fixture · TTL ${demo.ttlSeconds} giây. Chưa phải đăng ký hay thanh toán.`
                      : "Chưa tích hợp Enrollment. Demo giữ chỗ đang tắt."}
                  </p>
                  {demo.enabled && (
                    <Field name="fixture" label="Học viên thử đã seed">
                      <select
                        id="fixture"
                        value={fixture}
                        onChange={(e) => setFixture(e.target.value)}
                      >
                        <option value="">Chọn fixture</option>
                        {demo.fixtures
                          .filter((f) => f.branchId === selected.branchId)
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  <p id="hold-reason" className="muted">
                    {reason ||
                      "Chỗ được kiểm tra lại nguyên tử khi gửi yêu cầu."}
                  </p>
                  <button
                    className="primary"
                    aria-describedby="hold-reason"
                    disabled={busy || !!reason || loading || !!error}
                    onClick={() => void hold()}
                  >
                    {busy ? "Đang xử lý…" : "Giữ chỗ"}
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      )}
      {canHold && (
        <section className="ops-panel">
          <div className="ops-heading">
            <h2>Giữ chỗ của bạn</h2>
            <button disabled={holdsLoading} onClick={() => void loadHolds()}>
              Kiểm tra trạng thái
            </button>
          </div>
          <ErrorMessage error={holdError} retry={() => void loadHolds()} />
          {!!holdError && (
            <p>
              Trạng thái chưa xác định. Cần xác minh lại API trước khi kết luận.
            </p>
          )}
          {holdsLoading ? (
            <p role="status">Đang xác minh hold…</p>
        ) : holdError ? null : !holds.length ? (
            <p>Chưa có giữ chỗ. Chọn chi tiết lớp để bắt đầu demo kỹ thuật.</p>
          ) : (
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Lớp / Mã giữ chỗ</th>
                    <th>Trạng thái server</th>
                    <th>Hết hạn · UTC+7</th>
                    <th className="num">Còn lại</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {holds.map((h) => {
                    const remaining = Math.max(
                      0,
                      Math.ceil(
                        (Date.parse(h.expiresAt) - now - offset) / 1000,
                      ),
                    );
                    return (
                      <tr key={h.id}>
                        <td>
                          {rows.find((r) => r.id === h.classId)?.name ??
                            h.classId}
                          <p className="muted">{h.id.slice(0, 8)}</p>
                        </td>
                        <td>
                          {holdError
                            ? "Chưa xác định"
                            : h.status === "HELD" && remaining === 0
                              ? "Đang xác minh hết hạn…"
                              : h.status}
                        </td>
                        <td>{dateTime(h.expiresAt)}</td>
                        <td className="num">
                          {h.status === "HELD"
                            ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                            : "—"}
                        </td>
                        <td>
                          {h.status === "HELD" && (
                            <button
                              disabled={busy || !!holdError}
                              onClick={() => setCancel(h)}
                            >
                              Hủy giữ chỗ
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">
            Tối đa 100 hold gần nhất của tài khoản. Đồng hồ theo server; tải lại
            không mất hold.
          </p>
        </section>
      )}
      {form && (
        <ClassForm
          current={form === "edit" ? selected : null}
          courses={courses}
          packages={packages}
          branches={branches}
          teachers={teachers}
          rooms={rooms}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void load();
          }}
        />
      )}
      {lifecycle && selected && <OperationDialog title={lifecycle === "CANCELLED" ? "Hủy lớp học" : lifecycle === "IN_PROGRESS" ? "Bắt đầu lớp học" : "Hoàn tất lớp học"} onClose={() => { if (!busy) setLifecycle(null); }}>
        <p><strong>{selected.name}</strong> · {selected.code}</p>
        <p className="muted">{lifecycle === "CANCELLED" ? "Các chỗ đang giữ sẽ được hủy; lịch được giữ trong hồ sơ và giải phóng khỏi lịch xếp lớp." : "Backend kiểm lại thời gian, sĩ số và trạng thái trước khi cập nhật."}</p>
        <form onSubmit={e => { e.preventDefault(); void transition(lifecycle, String(new FormData(e.currentTarget).get("reason"))); }}><Field name="lifecycle-reason" label="Lý do / ghi chú"><textarea id="lifecycle-reason" name="reason" required={lifecycle === "CANCELLED"} maxLength={1000} rows={3} /></Field><ErrorMessage error={error} /><div className="ops-actions"><button type="button" disabled={busy} onClick={() => setLifecycle(null)}>Đóng</button><button className="primary" disabled={busy}>{busy ? "Đang xử lý…" : "Xác nhận"}</button></div></form>
      </OperationDialog>}
      {roomForm && (
        <OperationDialog
          title="Thêm phòng học"
          onClose={() => setRoomForm(false)}
        >
          <form className="ops-form" onSubmit={createRoom}>
            <Field name="branchId" label="Chi nhánh" error={error}>
              <select id="branchId" name="branchId" required>
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
            <Field name="name" label="Tên phòng" error={error}>
              <input id="name" name="name" required maxLength={100} />
            </Field>
            <Field name="capacity" label="Sức chứa" error={error}>
              <input
                id="capacity"
                name="capacity"
                type="number"
                required
                min={1}
                max={500}
              />
            </Field>
            <div className="span">
              <ErrorMessage error={error} />
              <button className="primary" disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu phòng"}
              </button>
            </div>
          </form>
        </OperationDialog>
      )}
      {cancel && (
        <OperationDialog title="Hủy giữ chỗ" onClose={() => setCancel(null)}>
          <p>
            Hủy giữ chỗ lớp “
            {rows.find((r) => r.id === cancel.classId)?.name ?? cancel.classId}
            ”? Chỗ chỉ được trả khi backend xác nhận.
          </p>
          <ErrorMessage error={holdError} />
          <div className="ops-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void cancelHold()}
            >
              Xác nhận hủy giữ chỗ
            </button>
            <button disabled={busy} onClick={() => setCancel(null)}>
              Tiếp tục giữ
            </button>
          </div>
        </OperationDialog>
      )}
    </div>
  );
}
