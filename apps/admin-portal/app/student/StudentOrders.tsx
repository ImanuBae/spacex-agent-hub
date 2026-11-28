"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { dateTime, money } from "../../lib/services/classes";
import { offerFor, orderStatuses, registrationCode, type Enrollment } from "../../lib/student-portal";
import HubIcon from "../dashboard/components/HubIcon";
import { ResourceState, StudentEmpty, StudentHeading, StudentPanel } from "./StudentUI";
import { useOffers, useStudentClock, useStudentResource } from "./portal-data";

type Payment = {
  id: string; adapter: string; status: string; moneyStatus: string; amountDue: number; reference: string;
  expiresAt: string; qrImageDataUrl?: string; qrImageUrl?: string;
  transactions: { id: string; amount: number; receivedAt: string }[];
};
type Invoice = { id: string; enrollmentId: string; amount: number; createdAt: string };
const paymentStatuses: Record<string, string> = {
  OPEN: "Chờ chuyển khoản", EXPIRED: "Yêu cầu đã hết hạn", CANCELLED: "Yêu cầu đã hủy",
  REVIEW: "Cần đối soát", SETTLED: "Đã xác thực giao dịch",
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export default function StudentOrders() {
  const enrollments = useStudentResource<Enrollment[]>("student/enrollments");
  const offers = useOffers();
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    try {
      const prefix = "hub-checkout:";
      const ids = Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
        const packageId = key.slice(prefix.length);
        try { return uuid.test(packageId) && JSON.parse(sessionStorage.getItem(key) ?? "null")?.submitted ? [packageId] : []; }
        catch { return []; }
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaved(ids);
    } catch { /* Checkout history on this tab is optional. */ }
  }, []);
  const pending = saved.filter(id => !enrollments.data?.some(row => row.snapshot.packageId === id && ["HELD", "CONFIRMED", "CONFIRMING"].includes(row.status)));

  return <>
    <StudentHeading title="Lịch sử đơn hàng" subtitle="Theo dõi đăng ký, học phí và trạng thái giao dịch.">
      <Link className="sp-button" href="/student/don-hang/hoa-don">Xem hóa đơn</Link>
      <Link className="sp-button sp-primary" href="/khoa-hoc">Đăng ký khóa học <HubIcon name="arrow" size={16} /></Link>
    </StudentHeading>
    <StudentPanel title="Đơn hàng của bạn">
      <ResourceState error={enrollments.error} retry={enrollments.reload} loading={!enrollments.data} />
      {enrollments.data?.length === 0 && <StudentEmpty icon="finance" title="Bạn chưa có đơn hàng" />}
      {Boolean(enrollments.data?.length) && <div className="sp-table-wrap"><table className="sp-table">
        <thead><tr><th scope="col">Mã đăng ký / Khóa học</th><th scope="col">Ngày tạo</th><th scope="col">Tổng thanh toán</th><th scope="col">Trạng thái</th><th scope="col"><span className="sr-only">Thao tác</span></th></tr></thead>
        <tbody>{enrollments.data?.map(row => <tr key={row.id}>
          <td><strong>{offerFor(row, offers.data ?? [])?.courseName ?? row.snapshot.className ?? row.snapshot.packageName ?? registrationCode(row.id)}</strong><small>{registrationCode(row.id)}</small></td>
          <td>{row.createdAt ? dateTime(row.createdAt) : "—"}</td>
          <td>{money(row.snapshot.amountDue)}</td>
          <td><span className="sp-status" data-state={row.status}>{orderStatuses[row.status] ?? row.status}</span></td>
          <td><Link className="sp-text-link" href={`/student/don-hang/${row.id}`} aria-label={`Chi tiết ${registrationCode(row.id)}`}>Chi tiết <HubIcon name="chevron" size={15} /></Link></td>
        </tr>)}</tbody>
      </table></div>}
    </StudentPanel>
    {pending.length > 0 && <StudentPanel className="sp-stack-panel" title="Đăng ký lưu trên tab này">
      {pending.map(id => <Link key={id} className="sp-text-link sp-block-link" href={`/khoa-hoc/${id}#course-registration`}>
        {offers.data?.find(offer => offer.packageId === id)?.courseName ?? "Mở đăng ký"} <HubIcon name="arrow" size={15} />
      </Link>)}
    </StudentPanel>}
  </>;
}

export function StudentOrderDetail({ id, checkout = false }: { id: string; checkout?: boolean }) {
  const enrollment = useStudentResource<Enrollment>("student/enrollments/" + id, checkout ? 8000 : 0);
  const row = enrollment.data;
  const payment = useStudentResource<Payment | null>(row ? "student/order-payments/" + id : undefined,
    checkout && row && ["HELD", "CONFIRMING", "PENDING_HOLD", "PAYMENT_REVIEW"].includes(row.status) ? 5000 : 0);
  const invoice = useStudentResource<Invoice[]>(row && !checkout ? "student/invoices" : undefined);
  const receipt = payment.data;
  const now = useStudentClock(1000);
  const qr = !payment.error && !enrollment.error && row?.status === "HELD" && receipt?.status === "OPEN" &&
    Date.parse(receipt.expiresAt) > now && (!row.holdExpiresAt || Date.parse(row.holdExpiresAt) > now)
    ? receipt.qrImageDataUrl ?? receipt.qrImageUrl : undefined;
  const verified = receipt?.status === "SETTLED" && receipt.moneyStatus.startsWith("MATCHED");
  const [copied, setCopied] = useState("");
  return <>
    <Link href={checkout ? `/student/don-hang/${id}` : "/student/don-hang"} className="sp-back">← {checkout ? "Chi tiết đơn hàng" : "Lịch sử đơn hàng"}</Link>
    <StudentHeading title={checkout ? "Thanh toán học phí" : "Chi tiết đơn hàng"} subtitle={row ? registrationCode(row.id) : undefined}>
      {row?.status === "HELD" && !checkout && <Link href={`/student/thanh-toan/${id}`} className="sp-button sp-primary">Thanh toán <HubIcon name="arrow" size={16} /></Link>}
    </StudentHeading>
    <ResourceState error={enrollment.error} retry={enrollment.reload} loading={!row} />
    {row && <div className="sp-detail-grid">
      <StudentPanel title="Tóm tắt đơn hàng">
        <dl className="sp-details">
          <dt>Mã đơn hàng</dt><dd>{registrationCode(row.id)}</dd>
          <dt>Lớp / Gói học</dt><dd>{[row.snapshot.className, row.snapshot.packageName].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Thời gian tạo</dt><dd>{row.createdAt ? dateTime(row.createdAt) : "—"}</dd>
          <dt>Tổng thanh toán</dt><dd><strong>{money(row.snapshot.amountDue)}</strong></dd>
          <dt>Trạng thái đăng ký</dt><dd>{orderStatuses[row.status] ?? row.status}</dd>
          {row.holdExpiresAt && row.status === "HELD" && <><dt>Hạn giữ chỗ</dt><dd>{dateTime(row.holdExpiresAt)}</dd></>}
        </dl>
        {row.status === "CONFIRMED" && <Link className="sp-text-link" href={`/student/khoa-hoc/${id}`}>Xem khóa học <HubIcon name="arrow" size={15} /></Link>}
      </StudentPanel>
      <StudentPanel title={checkout ? "Chuyển khoản học phí" : "Giao dịch"}>
        <ResourceState error={payment.error} retry={payment.reload} loading={payment.data === undefined} />
        {payment.data === null && <StudentEmpty icon="finance" title="Chưa có yêu cầu thanh toán" />}
        {receipt && <div aria-busy={payment.refreshing}>
          <p className="sp-payment-status" role="status">{verified ? "Giao dịch đã được hệ thống xác thực." : paymentStatuses[receipt.status] ?? receipt.status}</p>
          {receipt.moneyStatus === "MATCHED_WITH_EXCESS" && <p>Khoản chuyển dư đang được đối soát.</p>}
          <dl className="sp-details">
            <dt>Phương thức</dt><dd>{receipt.adapter === "SEPAY" ? "Chuyển khoản VietQR qua SePay" : "Chuyển khoản mô phỏng"}</dd>
            <dt>Nội dung chuyển khoản</dt><dd><code>{receipt.reference}</code></dd>
            {checkout && <><dt>Số tiền</dt><dd>{money(receipt.amountDue)}</dd><dt>Hạn yêu cầu</dt><dd>{dateTime(receipt.expiresAt)}</dd></>}
          </dl>
          {checkout && qr && <div className="sp-qr">
            {/* Payment already returns a sized QR for this order. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} width={220} height={220} alt={receipt.adapter === "SEPAY" ? "VietQR thanh toán" : "Mã QR mô phỏng"} referrerPolicy="no-referrer" />
            <div><p>{receipt.adapter === "SEPAY" ? "Quét mã bằng ứng dụng ngân hàng của bạn." : "Mã chỉ dùng để kiểm thử."}</p>
              <button type="button" className="sp-button" onClick={() => void navigator.clipboard.writeText(receipt.reference).then(
                () => setCopied("Đã sao chép nội dung."), () => setCopied("Hãy chọn và sao chép nội dung ở trên."),
              )}>Sao chép nội dung</button><p role="status">{copied}</p></div>
          </div>}
          {receipt.transactions.map(tx => <div className="sp-transaction" key={tx.id}><time dateTime={tx.receivedAt}>{dateTime(tx.receivedAt)}</time><strong>{money(tx.amount)}</strong></div>)}
        </div>}
        {checkout && <button type="button" className="sp-button" disabled={enrollment.refreshing || payment.refreshing}
          onClick={() => { enrollment.reload(); if (row) payment.reload(); }}><HubIcon name="refresh" size={16} /> Cập nhật trạng thái</button>}
      </StudentPanel>
      {!checkout && <StudentPanel title="Hóa đơn" href="/student/don-hang/hoa-don" label="Quản lý hóa đơn">
        <ResourceState error={invoice.error} retry={invoice.reload} loading={!invoice.data} />
        {invoice.data?.filter(item => item.enrollmentId === id).map(item => <p key={item.id}>
          <a className="sp-text-link" href={`/api/v1/student/invoices/${item.id}/download`}>Tải hóa đơn mô phỏng · {money(item.amount)}</a>
        </p>)}
        {invoice.data && !invoice.data.some(item => item.enrollmentId === id) && <p className="sp-muted">Chưa có hóa đơn cho đơn hàng này.</p>}
      </StudentPanel>}
    </div>}
  </>;
}
