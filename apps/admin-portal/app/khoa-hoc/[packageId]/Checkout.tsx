"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { SelfRegistrationPerson, type PublicClass, type PublicOffer } from "@spacex/contracts";
import { dateTime, money, OperationError } from "../../../lib/services/classes";
import { ChatButton } from "../../chat/ChatWidget";
import CheckoutOrder from "./CheckoutOrder";
import CheckoutProgress from "./CheckoutProgress";
import { checkoutApi, checkoutRequest, type Attempt, type Preview } from "./checkout-api";

const fields = [
  { name: "fullName", label: "Họ và tên", autoComplete: "name", required: true, type: "text", max: 120 },
  { name: "email", label: "Email", autoComplete: "email", required: true, type: "email", max: 254 },
  { name: "phone", label: "Số điện thoại", autoComplete: "tel", required: true, type: "tel", max: 30 },
  { name: "birthYear", label: "Năm sinh", type: "text", max: 4 },
  { name: "address", label: "Địa chỉ", autoComplete: "street-address", type: "text", max: 300 },
  { name: "notes", label: "Ghi chú", type: "text", max: 1000 },
] as const;
const empty = { fullName: "", email: "", phone: "", birthYear: "", address: "", notes: "" };
type Field = keyof typeof empty;
type Errors = Partial<Record<Field, string>>;
export default function Checkout({ offer, classes }: { offer: PublicOffer; classes: PublicClass[] | null }) {
  const available = classes?.filter(cls => cls.availableSeats > 0) ?? [];
  const [classId, setClassId] = useState(available[0]?.id ?? "");
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [accepted, setAccepted] = useState(false);
  const [phase, setPhase] = useState<"classes" | "form" | "review">("classes");
  const [preview, setPreview] = useState<Preview>();
  const [order, setOrder] = useState<Attempt>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const storage = `hub-checkout:${offer.packageId}`;

  function readAttempt(): Attempt | undefined {
    const saved = sessionStorage.getItem(storage);
    if (saved) return JSON.parse(saved);
  }
  function remember(attempt: Attempt) { sessionStorage.setItem(storage, JSON.stringify(attempt)); }
  useEffect(() => {
    const saved = sessionStorage.getItem(storage);
    if (saved) {
      const attempt: Attempt = JSON.parse(saved);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (attempt.submitted && attempt.id) setOrder(attempt);
    }
    setReady(true);
  }, [storage]);

  function move(next: typeof phase) {
    setPhase(next);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function describeFailure(failure: unknown) {
    return failure instanceof OperationError ? failure.message : "Kết nối bị gián đoạn. Vui lòng thử lại.";
  }
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const valid = SelfRegistrationPerson.safeParse(values);
    if (!valid.success) {
      const fields: Errors = {};
      for (const issue of valid.error.issues) {
        const name = issue.path[0] as Field;
        fields[name] ??= issue.message;
      }
      setErrors(fields);
      requestAnimationFrame(() => document.getElementById(`checkout-${Object.keys(fields)[0]}`)?.focus());
      return;
    }
    inFlight.current = true; setBusy(true); setError(""); setStale(false);
    try {
      const saved = readAttempt();
      const attempt = saved?.classId === classId ? saved : { key: crypto.randomUUID(), id: "", classId, submitted: false };
      remember(attempt);
      const price = await checkoutRequest<Preview>(`${checkoutApi}/preview`, attempt.key, { packageId: offer.packageId, classId });
      remember({ ...attempt, id: price.id });
      setPreview(price); setAccepted(false); move("review");
    } catch (failure) {
      if (failure instanceof OperationError && failure.code === "PREVIEW_EXPIRED") sessionStorage.removeItem(storage);
      setError(describeFailure(failure));
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !accepted || !preview || stale) return;
    const attempt = readAttempt();
    if (!attempt?.id) return;
    inFlight.current = true; setBusy(true); setError("");
    const submitted = { ...attempt, submitted: true };
    remember(submitted);
    try {
      await checkoutRequest(`${checkoutApi}/${attempt.id}/confirm`, attempt.key, { accepted: true, person: SelfRegistrationPerson.parse(values) });
      setOrder(submitted);
    } catch (failure) {
      if (failure instanceof OperationError && ["PREVIEW_EXPIRED", "OFFER_CHANGED", "CLASS_UNAVAILABLE", "NOT_SELLABLE", "VALIDATION_ERROR", "IDEMPOTENCY_CONFLICT", "LEARNER_EMAIL_UNAVAILABLE"].includes(failure.code)) {
        remember(attempt);
        if (failure.code === "LEARNER_EMAIL_UNAVAILABLE") {
          setErrors({ email: failure.message }); move("form");
          requestAnimationFrame(() => document.getElementById("checkout-email")?.focus());
          return;
        } else if (failure.code === "VALIDATION_ERROR") {
          const invalid: Errors = {};
          for (const issue of failure.details) invalid[issue.path.replace("person.", "") as Field] = issue.message;
          setErrors(invalid); move("form");
        } else setStale(true);
        setError(describeFailure(failure));
      } else {
        setOrder(submitted);
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  function reset() {
    sessionStorage.removeItem(storage);
    setOrder(undefined); setPreview(undefined); setAccepted(false); setStale(false);
    move(available.length ? "form" : "classes");
  }
  if (!ready) return <section className="checkout-panel"><p role="status">Đang kiểm tra đăng ký…</p></section>;
  if (order) return <CheckoutOrder attempt={order} resume={() => { setOrder(undefined); move(preview ? "review" : "form"); }} reset={reset} />;

  const classInfo = available.find(cls => cls.id === classId);
  return <section className="checkout-panel" aria-labelledby="checkout-title" aria-busy={busy}>
    <CheckoutProgress step={phase === "classes" ? 0 : phase === "form" ? 1 : 2} />
    <h2 id="checkout-title" ref={heading} tabIndex={-1}>{phase === "classes" ? "Lớp đang mở đăng ký" : phase === "form" ? "Thông tin học viên" : "Kiểm tra đăng ký"}</h2>
    {error && <p className="checkout-error" role="alert">{error}</p>}
    {phase === "classes" && <>
      {available.length > 0 ? <>
        <p className="checkout-description">Chọn lịch phù hợp để tiếp tục đăng ký.</p>
        <fieldset className="checkout-classes">
          <legend className="sr-only">Chọn lớp</legend>
          {classes?.map(cls => <label key={cls.id} className="checkout-class">
            <input type="radio" name="class" value={cls.id} checked={classId === cls.id} disabled={!cls.availableSeats} onChange={() => setClassId(cls.id)} />
            <span><strong>{cls.name}</strong><span>{cls.code} · {cls.mode === "online" ? "Trực tuyến" : "Tại phòng"}</span>
              {cls.startsAt && <span>Khai giảng {dateTime(cls.startsAt)}</span>}</span>
            <span>{cls.availableSeats ? `Còn ${cls.availableSeats} chỗ` : "Hết chỗ"}</span>
          </label>)}
        </fieldset>
        <button className="btn btn-primary" type="button" onClick={() => move("form")}>Đăng ký học</button>
      </> : <>
        <p>{!offer.sellable ? "Gói học hiện ngừng nhận đăng ký." : classes === null ? "Chưa kiểm tra được lịch và chỗ học. Bạn có thể tải lại trang hoặc hỏi tư vấn."
          : classes.length ? "Các lớp của gói này đã hết chỗ." : "Hiện chưa có lớp đang mở phù hợp với gói này."}</p>
        {classes === null && offer.sellable && <a className="btn btn-outline" href={`/khoa-hoc/${offer.packageId}#course-registration`}>Tải lại lịch lớp</a>}
        <ChatButton className="btn btn-ghost">Hỏi tư vấn</ChatButton>
      </>}
    </>}
    {phase === "form" && <form noValidate onSubmit={review}>
      {classInfo && <p className="checkout-class-name">{classInfo.name} · {classInfo.code}<br />Học phí dự kiến <strong>{money(offer.priceVnd)}</strong></p>}
      <div className="checkout-fields">
        {fields.map(field => {
          const { name, label, max } = field;
          const id = `checkout-${name}`;
          const shared = { id, name, maxLength: max, value: values[name], "aria-invalid": !!errors[name],
            "aria-describedby": errors[name] ? id + "-error" : undefined };
          function change(value: string) {
            setValues(current => ({ ...current, [name]: value }));
            if (errors[name]) setErrors(current => ({ ...current, [name]: undefined }));
          }
          return <div key={name} className={name === "notes" ? "checkout-wide" : ""}>
            <label htmlFor={id}>{label} {("required" in field) ? <span aria-hidden="true">*</span> : <small>(không bắt buộc)</small>}</label>
            {name === "notes" ? <textarea {...shared} rows={3} onChange={event => change(event.target.value)} /> :
              <input {...shared} type={field.type} required={"required" in field} autoComplete={"autoComplete" in field ? field.autoComplete : undefined}
                inputMode={name === "birthYear" ? "numeric" : undefined} onChange={event => change(event.target.value)} />}
            {errors[name] && <p className="checkout-error" id={id + "-error"}>{errors[name]}</p>}
          </div>;
        })}
      </div>
      <div className="checkout-actions">
        <button className="btn btn-primary" disabled={busy || !classInfo}>Kiểm tra đăng ký</button>
        <button className="btn btn-outline" type="button" disabled={busy} onClick={() => move("classes")}>Đổi lớp</button>
      </div>
    </form>}
    {phase === "review" && preview && <form onSubmit={confirm}>
      <dl className="checkout-summary">
        <dt>Gói học</dt><dd>{preview.packageName}</dd>
        <dt>Lớp</dt><dd>{preview.className} · {preview.classCode}</dd>
        <dt>Email đăng nhập</dt><dd>{values.email.trim().toLowerCase()}</dd>
        <dt>Tổng tiền</dt><dd><strong>{money(preview.amountDue)}</strong></dd>
      </dl>
      <div className="checkout-terms">
        <h3>Điều khoản đăng ký</h3><p>{preview.terms}</p>
        {preview.coursePolicy && <p>{preview.coursePolicy}</p>}
        {preview.packagePolicy && preview.packagePolicy !== preview.coursePolicy && <p>{preview.packagePolicy}</p>}
      </div>
      <label className="checkout-consent"><input type="checkbox" required checked={accepted} disabled={stale || busy} onChange={event => setAccepted(event.target.checked)} />
        <span>Tôi đồng ý với điều khoản đăng ký. {preview.registrationConsent} {preview.courseNoticesConsent}</span>
      </label>
      <div className="checkout-actions">
        {stale ? <><button className="btn btn-primary" type="button" onClick={reset}>Kiểm tra lại</button><ChatButton className="btn btn-outline">Hỏi tư vấn</ChatButton></> :
          <button className="btn btn-primary" disabled={!accepted || busy}>{busy ? "Đang xác nhận…" : "Xác nhận và thanh toán"}</button>}
        <button className="btn btn-outline" type="button" disabled={busy} onClick={() => move("form")}>Sửa thông tin</button>
      </div>
    </form>}
    {phase === "classes" && <p className="checkout-login"><Link href="/student/login">Đăng nhập cổng học viên</Link></p>}
  </section>;
}
