"use client";
import { useEffect, useState } from "react";
import { allPages, api, type ClassView } from "../../../lib/services/classes";
import { type Enrollment } from "../../../lib/services/enrollments";
import { type PersonView } from "../../../lib/services/crm";
import { states } from "../../../lib/services/adjustments";
import { Field } from "./OperationUI";

type Entitlement = { id: string; classId: string; version: number; state: string; learnerId: string };
export function useEnrollmentPicker(initialId: string, accountant: boolean) {
  const [id, setId] = useState(initialId), [refresh, setRefresh] = useState(0);
  const [options, setOptions] = useState<{ enrollments: Enrollment[]; people: PersonView[]; classes: ClassView[] }>();
  const [current, setCurrent] = useState<{ entitlement: Entitlement; cls?: ClassView }>();
  const [listError, setListError] = useState<unknown>(null), [detailError, setDetailError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    Promise.all([allPages<Enrollment>("enrollments"), accountant ? [] : allPages<PersonView>("crm/people"), accountant ? [] : allPages<ClassView>("classes")])
      .then(([enrollments, people, classes]) => { if (active) setOptions({ enrollments, people, classes }); })
      .catch(error => { if (active) setListError(error); });
    return () => { active = false; };
  }, [accountant]);
  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    let active = true;
    async function load() {
      try {
        const { data: entitlement } = await api<Entitlement>(`enrollments/${id}/entitlement`);
        const cls = accountant ? undefined : (await api<ClassView>(`classes/${entitlement.classId}`)).data;
        if (active) setCurrent({ entitlement, cls });
      } catch (error) { if (active) setDetailError(error); }
    }
    void load();
    return () => { active = false; };
  }, [id, refresh, accountant]);
  function select(value: string) { setId(value); setCurrent(undefined); setDetailError(null); }
  function reload() { setCurrent(undefined); setDetailError(null); setRefresh(value => value + 1); }
  return { id, select, reload, options, current: current?.entitlement.id === id ? current : undefined, error: detailError ?? listError };
}

export function EnrollmentPicker({ picker }: { picker: ReturnType<typeof useEnrollmentPicker> }) {
  const { id, select, options, current, error } = picker;
  const label = (learnerId: string) => options?.people.find(p => p.id === learnerId)?.fullName ?? learnerId;
  return <div className="span">
    <Field name="operation-enrollment" label="Mã đăng ký">
      <input id="operation-enrollment" list="operation-enrollments" value={id} onChange={e => select(e.target.value.trim())} required />
      <datalist id="operation-enrollments">{options?.enrollments.map(row => <option key={row.id} value={row.id}>{label(row.snapshot.learnerId)} · {options.classes.find(c => c.id === row.snapshot.classId)?.name ?? ""}</option>)}</datalist>
    </Field>
    {current ? <dl><dt>Học viên</dt><dd>{label(current.entitlement.learnerId)}</dd>
      <dt>Lớp hiện hành</dt><dd>{current.cls?.name ?? current.entitlement.classId}</dd>
      <dt>Quyền lợi</dt><dd>{states[current.entitlement.state] ?? current.entitlement.state}</dd></dl>
      : id && !error && <p className="muted" role="status">{/^[0-9a-f-]{36}$/i.test(id) ? "Đang kiểm tra đăng ký…" : "Chọn đăng ký hoặc nhập đầy đủ mã."}</p>}
    {id && <button type="button" onClick={picker.reload}>Tải lại thông tin đăng ký</button>}
  </div>;
}
