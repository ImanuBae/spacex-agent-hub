"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { dateTime, money, OperationError } from "../../../lib/services/classes";
import { ChatButton } from "../../chat/ChatWidget";
import { checkoutApi, checkoutRequest, type Attempt, type Preview } from "./checkout-api";
import CheckoutProgress from "./CheckoutProgress";

const statuses = {
  PREPARING: ["Đang chuẩn bị thanh toán", "Hệ thống đang giữ chỗ và tạo mã thanh toán cho đăng ký này."],
  AWAITING_PAYMENT: ["Chờ thanh toán", "Quét mã QR hoặc nhập đúng số tiền và nội dung chuyển khoản."],
  CONFIRMING: ["Đang xác nhận chỗ", "Đã ghi nhận giao dịch. Hệ thống đang chốt chỗ trong lớp."],
  CONFIRMED: ["Đăng ký thành công", "Lớp đã xác nhận chỗ của bạn. Mở hộp thư đã nhập khi đăng ký để nhận mã xác minh và vào cổng học viên."],
  EXPIRED: ["Hết hạn", "Hạn giữ chỗ đã qua. Nếu đã chuyển khoản, hãy giữ chứng từ và mở tư vấn để được hỗ trợ."],
  REVIEW: ["Cần đối soát", "Giao dịch hoặc chỗ học cần được kiểm tra. Bạn có thể chờ cập nhật hoặc hỏi tư vấn về đơn."],
  UNAVAILABLE: ["Không giữ được chỗ", "Lớp đã hết chỗ hoặc điều kiện đăng ký đã thay đổi. Bạn có thể kiểm tra các lớp đang mở hoặc hỏi tư vấn."],
  DRAFT: ["Đang kiểm tra xác nhận", "Bạn có thể kiểm tra trạng thái lại hoặc gửi lại cùng yêu cầu xác nhận."],
} as const;
type Order = Preview & {
  status: keyof typeof statuses;
  holdExpiresAt: string | null;
  payment: { id: string; reference: string; adapter: string; moneyStatus: string; qrImageDataUrl?: string; qrImageUrl?: string } | null;
};

function VerifyEmail({ attempt }: { attempt: Attempt }) {
  const router = useRouter();
  const [expiresAt, setExpiresAt] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const storage = `hub-checkout-otp:${attempt.id}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(storage);
    // Restore the expiry display only. The browser binding stays in the HttpOnly cookie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved && Date.parse(saved) > Date.now()) setExpiresAt(saved);
  }, [storage]);

  async function otp(action: "request" | "verify") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const data = await checkoutRequest<{ expiresAt: string }>(`/api/student-session/checkout-${action}`, attempt.key, {
        checkoutId: attempt.id, browserKey: attempt.key, ...(action === "verify" ? { code } : {}),
      });
      if (action === "verify") {
        sessionStorage.removeItem(storage);
        router.push("/student");
      } else {
        sessionStorage.setItem(storage, data.expiresAt);
        setExpiresAt(data.expiresAt); setCode("");
        requestAnimationFrame(() => input.current?.focus());
      }
    } catch (failure) {
      setError(failure instanceof OperationError
        ? failure.code === "OTP_INVALID" ? "Mã xác minh sai hoặc đã hết hạn." : failure.message
        : "Chưa kết nối được dịch vụ xác minh. Vui lòng thử lại.");
    } finally { setBusy(false); }
  }
  function verify(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void otp("verify"); }

  return <div className="checkout-verification">
    {!expiresAt ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void otp("request")}>
      {busy ? "Đang gửi mã…" : "Gửi mã xác minh email"}
    </button> : <form onSubmit={verify}>
      <p role="status">Kiểm tra hộp thư đến và thư rác. Mã có hiệu lực đến {dateTime(expiresAt)}.</p>
      <label htmlFor="checkout-code">Mã xác minh</label>
      <input id="checkout-code" ref={input} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
        value={code} onChange={event => setCode(event.target.value)} aria-describedby={error ? "checkout-otp-error" : undefined} aria-invalid={!!error} />
      <div className="checkout-actions">
        <button className="btn btn-primary" disabled={busy || !/^\d{6}$/.test(code)}>Xác minh và đăng nhập</button>
        <button className="btn btn-outline" type="button" disabled={busy} onClick={() => void otp("request")}>Gửi lại mã</button>
      </div>
    </form>}
    {error && <p id="checkout-otp-error" className="checkout-error" role="alert">{error}</p>}
  </div>;
}

export default function CheckoutOrder({ attempt, resume, reset }: { attempt: Attempt; resume: () => void; reset: () => void }) {
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState("");
  const [readCount, setReadCount] = useState(0);
  const [copied, setCopied] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      let next: Order | undefined;
      try {
        next = await checkoutRequest<Order>(`${checkoutApi}/${attempt.id}`, attempt.key, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setError(""); setOrder(next);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof OperationError ? failure.message : "Chưa cập nhật được trạng thái đơn. Vui lòng thử lại.");
        if (failure instanceof OperationError && failure.code === "CHECKOUT_NOT_FOUND") return;
      }
      if (next?.status !== "CONFIRMED") timer = setTimeout(() => void load(), next?.status === "EXPIRED" || next?.status === "UNAVAILABLE" ? 12000 : 3000);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt.id, attempt.key, readCount]);
  useEffect(() => { heading.current?.focus(); }, []);

  const [title, description] = order ? statuses[order.status] : ["Đang tải đăng ký", ""];
  const tone = order?.status === "CONFIRMED" ? "success"
    : order?.status === "UNAVAILABLE" || error ? "error"
    : order?.status === "EXPIRED" || order?.status === "REVIEW" || order?.status === "AWAITING_PAYMENT" ? "warning" : "progress";
  const payment = order?.payment;
  const qr = payment?.qrImageDataUrl ?? payment?.qrImageUrl;
  return <section className="checkout-panel" aria-labelledby="checkout-order">
    <CheckoutProgress step={3} complete={order?.status === "CONFIRMED"} />
    <div className="checkout-state" data-tone={tone} role="status" aria-atomic="true">
      <h2 id="checkout-order" tabIndex={-1} ref={heading}>{title}</h2>
      {description && <p className="checkout-description">{description}</p>}
    </div>
    {error && <p className="checkout-error" role="alert">{error}</p>}
    {order && <dl className="checkout-summary">
      <dt>Gói học</dt><dd>{order.packageName}</dd>
      <dt>Lớp</dt><dd>{order.className} · {order.classCode}</dd>
      <dt>Số tiền</dt><dd><strong>{money(order.amountDue)}</strong></dd>
      {payment && <><dt>Mã chuyển khoản</dt><dd><code>{payment.reference}</code></dd></>}
      {order.holdExpiresAt && <><dt>Hạn giữ chỗ</dt><dd>{dateTime(order.holdExpiresAt)}</dd></>}
    </dl>}
    {order?.status === "AWAITING_PAYMENT" && payment && <div className="checkout-payment">
      {qr && (
        // Payment supplies an already sized QR image for the current request.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="checkout-qr" src={qr} alt={payment.adapter === "SEPAY" ? "VietQR thanh toán qua SePay" : "Mã QR thanh toán mô phỏng"} width={220} height={220} referrerPolicy="no-referrer" />
      )}
      <div>
        <p>{payment.adapter === "SYNTHETIC" ? "Mã QR mô phỏng dành cho kiểm thử." : "Mở ứng dụng ngân hàng để quét mã VietQR."}</p>
        <button className="btn btn-outline" type="button" onClick={() => void navigator.clipboard.writeText(payment.reference).then(
          () => setCopied("Đã sao chép mã."), () => setCopied("Hãy chọn và sao chép mã chuyển khoản ở trên."))}>Sao chép mã</button>
        <p className="checkout-copy" role="status">{copied}</p>
      </div>
    </div>}
    {order?.status === "CONFIRMED" && <>
      {payment?.moneyStatus === "MATCHED_WITH_EXCESS" && <p>Khoản chuyển dư đang được đối soát.</p>}
      <VerifyEmail attempt={attempt} />
    </>}
    {order?.status !== "CONFIRMED" && <div className="checkout-actions">
      <button type="button" className="btn btn-outline" onClick={() => setReadCount(current => current + 1)}>Cập nhật trạng thái</button>
      {order?.status === "DRAFT" && <button type="button" className="btn btn-outline" onClick={resume}>Quay lại xác nhận</button>}
      {(order?.status === "EXPIRED" || order?.status === "UNAVAILABLE") &&
        <button type="button" className="btn btn-outline" onClick={reset}>Đăng ký lại</button>}
      {(["REVIEW", "EXPIRED", "UNAVAILABLE"].includes(order?.status ?? "") || error) && <ChatButton className="btn btn-outline">Hỏi tư vấn</ChatButton>}
    </div>}
  </section>;
}
