"use client";

import { useState } from "react";
import Link from "next/link";
import { api, dateTime } from "../../lib/services/classes";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";
import { useStudent } from "./StudentShell";

const templates: Record<string, string> = {
  ENROLLMENT_CONFIRMED: "Đăng ký", CLASS_CHANGED: "Đổi lịch",
  ENTITLEMENT_CHANGED: "Quyền học", REMINDER: "Nhắc lịch",
};

export default function StudentNotices() {
  const { notices } = useStudent();
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const rows = (notices.data ?? []).filter(row => (filter === "all" || (filter === "unread" ? !row.readAt : row.readAt)) && (!category || row.template === category));

  async function mark(id?: string) {
    setBusy(true); setError(undefined);
    try { await api("notifications/read", "PUT", id ? { id } : { all: true }); notices.reload(); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <>
    <StudentHeading title="Thông báo" subtitle="Cập nhật đăng ký, lớp học và quyền học của bạn.">
      <button type="button" className="sp-button" disabled={busy || notices.refreshing || !notices.data?.some(row => !row.readAt)}
        onClick={() => void mark()}>Đánh dấu tất cả đã đọc</button>
    </StudentHeading>
    <div className="sp-filters">
      <label><span>Trạng thái</span><select value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">Tất cả</option><option value="unread">Chưa đọc</option><option value="read">Đã đọc</option>
      </select></label>
      <label><span>Loại thông báo</span><select value={category} onChange={event => setCategory(event.target.value)}>
        <option value="">Tất cả loại</option>{Object.entries(templates).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </select></label>
    </div>
    <StudentPanel title="Hộp thư" href="/student/cai-dat#student-notice-settings" label="Tùy chọn thông báo">
      <ResourceState error={notices.error} retry={notices.reload} loading={!notices.data} />
      <ResourceState error={error} />
      {notices.data && rows.length === 0 && <StudentEmpty icon="bell" title="Không có thông báo trong bộ lọc này" />}
      {rows.map(row => <article id={`notice-${row.id}`} className="sp-notice" key={row.id} data-unread={!row.readAt}>
        <div><h3>{!row.readAt && <span className="sp-unread-dot" aria-label="Chưa đọc" />}{row.subject}</h3>
          <small>{templates[row.template] ?? "Hệ thống"} · {dateTime(row.createdAt)}</small>
          <p>{row.body}</p>
        </div>
        <div className="sp-actions">
          {!row.readAt && <button type="button" className="sp-button" disabled={busy || notices.refreshing} onClick={() => void mark(row.id)}>Đánh dấu đã đọc</button>}
          {row.enrollmentId && <Link className="sp-text-link" href={`/student/khoa-hoc/${row.enrollmentId}`}>Xem khóa học →</Link>}
        </div>
      </article>)}
    </StudentPanel>
  </>;
}
