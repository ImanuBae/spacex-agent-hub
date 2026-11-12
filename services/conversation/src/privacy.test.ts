import { expect, it } from "vitest";
import { ChatMessageInput, ConversationModeInput, ConversationDraft } from "@spacex/contracts";
import { redact } from "./privacy.js";
it("minimizes contact data and rejects client authority and unbounded messages", () => {
  expect(redact("Liên hệ demo@example.test hoặc 0901234567")).toBe("Liên hệ [email] hoặc [phone]");
  expect(redact("Họ tên: DEMO Nguyễn Văn An; địa chỉ: DEMO đường số 1")).toBe("[personal information]; [personal information]");
  expect(ChatMessageInput.safeParse({ clientMessageId: crypto.randomUUID(), text: "hi", branchId: crypto.randomUUID() }).success).toBe(false);
  expect(ChatMessageInput.safeParse({ clientMessageId: crypto.randomUUID(), text: "x".repeat(2001) }).success).toBe(false);
  expect(ConversationModeInput.safeParse({ expectedVersion: 1, mode: "AI", ownerId: "admin" }).success).toBe(false);
  expect(ConversationDraft.safeParse({ text: "unfenced" }).success).toBe(false);
});
it("does not claim to remove unlabelled PII, secrets or internal prose", () => {
  const prose = "Em là Nguyễn Văn An, ở ngõ Hoa Sen; hồ sơ bệnh án riêng. Nội bộ: mật khẩu demo-secret.";
  expect(redact(prose)).toBe(prose);
});
it("preserves source dates, UUIDs and explicit VND prices while still masking contact data and labelled birth dates", () => {
  const source = "Lớp 80ff58a9-9946-4f23-b284-29209339af20, lịch 2026-11-26 10:38:49 UTC hoặc 2026-11-26T10:38:49.123Z; giá 1.000.000 VND và 100.000.000đ.";
  expect(redact(source)).toBe(source);
  expect(redact("SĐT0901234567, +84 (901) 234 567; email demo@example.test; ngày sinh: 2000-01-02")).toBe("SĐT[phone], [phone]; email [email]; [personal information]");
});
