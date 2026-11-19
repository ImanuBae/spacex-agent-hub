"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./classes";

export const states: Record<string, string> = {
  REQUESTED: "Chờ duyệt", APPROVED: "Đã duyệt", PREPARED: "Đang xử lý", COMMITTING: "Đang chốt chỗ mới",
  TARGET_COMMITTED: "Đã chốt chỗ mới", APPLIED: "Quyền lợi đã cập nhật", WAITING: "Đang chờ xử lý",
  RESERVED: "Đã dự trù tiền hoàn", AUTHORIZED: "Đã cho phép thực hiện", EXECUTED: "Đã thực hiện", FAILED: "Thực hiện thất bại",
  UNKNOWN: "Chưa xác minh được kết quả", REJECTED: "Đã từ chối", REVOKED: "Đã thu hồi",
  EXPIRED: "Đã hết hạn", ACTIVE: "Đang có hiệu lực", CANCELLED: "Đã hủy", SUSPENDED: "Đang bảo lưu",
  PENDING: "Chờ gửi", SENT: "Đã gửi", SUPERSEDED: "Đã thay thế",
  INVITED: "Đã mời", QUEUED: "Đang chờ chỗ", ACCEPTED: "Đã nhận lời mời", DECLINED: "Đã từ chối lời mời",
};
export const kinds: Record<string, string> = {
  REFUND: "Hoàn tiền", TRANSFER: "Chuyển lớp", SUSPEND: "Bảo lưu", RESUME: "Dùng lại quyền lợi", WAITLIST: "Nhận chỗ từ danh sách chờ",
  RESCHEDULE: "Đổi lịch", MAKEUP: "Học bù", POSTPONE: "Hoãn lớp", CANCEL: "Hủy lớp", MINIMUM_SIZE: "Quyết định sĩ số",
};
export type Operation = { id: string; status: string; version: number; deadlineAt?: string };
export type Adjustment = Operation & { enrollmentId: string; type: string; amountDelta: number; reason: string; customerChoice: boolean; target?: { classId: string; amount: number }; history?: { version: number; action: string; createdAt: string }[] };
export type ClassChange = Operation & { classId: string; kind: string; payload: { reason: string }; impact: { holds: unknown[]; enrollments: { enrollmentId: string; state: string }[] } };

export function useOperations<T>(resource: string) {
  const [rows, setRows] = useState<T[]>([]), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const run = useCallback(async (change?: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { if (change) await change(); setRows((await api<T[]>(resource)).data); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }, [resource]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);
  return { rows, busy, error, run };
}
