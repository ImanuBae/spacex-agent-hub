"use client";
import { useState, type FormEvent } from "react";
import { api, dateTime, money, type Branch, type Package } from "../../../lib/services/classes";
import type { Course } from "../../../lib/services/courses";
import { ErrorMessage, Field, OperationDialog } from "../components/OperationUI";

export function OfferHistory({ resource, id, onClose }: { resource: "courses" | "packages"; id: string; onClose: () => void }) {
  const [result, setResult] = useState<{ version: number; effectiveAt: string; snapshot: { name: string; price_vnd: number; policy_text?: string; status: string } }[] | null>(null);
  const [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setError(null);
    try { setResult((await api<NonNullable<typeof result>>(`${resource}/${id}/history`)).data); }
    catch (e) { setError(e); }
    finally { setLoading(false); }
  }
  return <OperationDialog title="Lịch sử giá và chính sách" onClose={onClose}>
    <p className="muted">Mỗi phiên bản giữ nguyên nội dung tại thời điểm có hiệu lực.</p>
    <button onClick={() => void load()} disabled={loading}>{loading ? "Đang tải…" : result ? "Tải lại lịch sử" : "Tải lịch sử"}</button>
    <ErrorMessage error={error} />
    {result && !error && result.map(row => <section className="ops-panel" key={row.version}>
      <h3>Phiên bản {row.version} · {row.snapshot.name}</h3><p className="muted">{dateTime(row.effectiveAt)} · {row.snapshot.status}</p>
      <p>{money(Number(row.snapshot.price_vnd))}</p><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.snapshot.policy_text || "Chưa khai nội dung chính sách tại phiên bản này."}</p>
    </section>)}
  </OperationDialog>;
}

export default function CatalogSearch({ courses, branches }: { courses: Course[]; branches: Branch[] }) {
  const [rows, setRows] = useState<Package[] | null>(null), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState<unknown>(null);
  async function load(search: string, nextPage = 1) {
    setLoading(true); setError(null);
    try {
      const response = await api<Package[]>(`packages?${search}&page=${nextPage}&pageSize=10`);
      setRows(response.data); setPage(nextPage); setTotal(response.pagination?.total ?? response.data.length);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }
  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const params = new URLSearchParams({ sellable: "true" });
    for (const [key, value] of new FormData(e.currentTarget)) if (String(value).trim()) params.set(key, String(value));
    setQuery(params.toString()); void load(params.toString());
  }
  return <details className="ops-panel">
    <summary>Tra gói học theo nhu cầu và ngân sách</summary>
    <form className="ops-form" onSubmit={search}>
      <Field name="search-goal" label="Mục tiêu học"><input id="search-goal" name="goal" maxLength={500} /></Field>
      <Field name="search-level" label="Trình độ"><select id="search-level" name="level"><option value="">Tất cả trình độ</option><option value="beginner">Cơ bản</option><option value="intermediate">Trung cấp</option><option value="advanced">Nâng cao</option></select></Field>
      <Field name="search-mode" label="Hình thức"><select id="search-mode" name="mode"><option value="">Tất cả hình thức</option><option value="online">Online</option><option value="onsite">Tại phòng</option></select></Field>
      <Field name="search-branch" label="Chi nhánh"><select id="search-branch" name="branchId"><option value="">Tất cả chi nhánh được phép bán</option>{branches.filter(b => b.active && b.kind === "branch").map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field name="search-min" label="Ngân sách tối thiểu (VND)"><input id="search-min" name="minPriceVnd" type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} /></Field>
      <Field name="search-max" label="Ngân sách tối đa (VND)"><input id="search-max" name="maxPriceVnd" type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} /></Field>
      <div className="span"><button disabled={loading}>{loading ? "Đang tra cứu…" : "Tra gói phù hợp"}</button></div>
    </form>
    <ErrorMessage error={error} retry={() => void load(query, page)} />
    {rows && !error && !loading && <><p className="muted">{total} gói phù hợp đang bán · ngân sách tính theo giá gói</p>{!rows.length ? <p>Chưa có gói phù hợp. Điều chỉnh nhu cầu hoặc ngân sách để tra lại.</p> : <div className="ops-table-wrap"><table><thead><tr><th>Gói học / Khóa</th><th className="num">Giá VND / Số buổi</th><th>Chính sách hiện hành</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.name}</strong><p className="muted">{courses.find(c => c.id === row.courseId)?.name ?? row.code}</p></td><td className="num">{money(row.priceVnd)}<p className="muted">{row.sessionCount} buổi</p></td><td><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.policyText || "Chưa khai chính sách gói"}</p><p className="muted">Phiên bản {row.policyVersion} · {dateTime(row.effectiveAt)}</p></td></tr>)}</tbody></table></div>}
    {total > 10 && <div className="ops-actions"><button disabled={page <= 1} onClick={() => void load(query, page - 1)}>Trang trước</button><span>Trang {page} / {Math.ceil(total / 10)}</span><button disabled={page * 10 >= total} onClick={() => void load(query, page + 1)}>Trang sau</button></div>}</>}
  </details>;
}
