export const transactionStatuses = {
  RECEIVED: "Đã ghi nhận tiền",
  ALLOCATED: "Đã phân bổ",
  REVIEW: "Cần đối soát",
  REFUND_PENDING: "Chờ hoàn",
  REFUNDED: "Đã hoàn",
};

export type Transaction = {
  id: string;
  transactionId: string;
  reference: string;
  amount: number;
  receivedAt: string | null;
  status: keyof typeof transactionStatuses;
  kind: "INCOMING" | "REFUND";
  demo: boolean;
  reviewId: string | null;
  receiptRef: string | null;
};
