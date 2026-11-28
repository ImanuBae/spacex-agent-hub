import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@spacex/http";

export const sePayPath = "/webhooks/sepay";
export const sePayConfig = z.object({
  account: z.string().regex(/^\d{6,30}$/),
  secret: z.string().min(32),
});

const transfer = z.object({
  id: z.number().int().positive(),
  accountNumber: z.string(),
  subAccount: z.string().nullish(),
  code: z.string().regex(/^[a-z0-9]{1,100}$/i).nullish(),
  transferType: z.enum(["in", "out"]),
  transferAmount: z.number().int().positive(),
});

export function sePayTransfer(body: unknown, timestamp: string, signature: string, config: z.infer<typeof sePayConfig>) {
  if (!Buffer.isBuffer(body) || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    throw new HttpError(401, "INVALID_SEPAY_SIGNATURE", "SePay webhook authentication failed");
  }
  const expected = createHmac("sha256", config.secret).update(timestamp + ".").update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) {
    throw new HttpError(401, "INVALID_SEPAY_SIGNATURE", "SePay webhook authentication failed");
  }
  let input: unknown;
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Invalid JSON body");
  }
  // SePay's dashboard can send a sample with ID zero.
  if (typeof input === "object" && input !== null && "id" in input && input.id === 0) return null;
  const event = transfer.parse(input);
  const reference = event.code?.toUpperCase() ?? "";
  if (event.transferType !== "in" || event.accountNumber !== config.account || event.subAccount ||
      !/^SX[A-F0-9]{12}$/.test(reference)) return null;
  return {
    provider: "SEPAY" as const,
    account: config.account,
    transactionId: String(event.id),
    reference,
    amount: event.transferAmount,
    currency: "VND" as const,
  };
}

export function sePayQr(account: string, amount: number, reference: string) {
  const url = new URL("https://vietqr.app/img");
  url.search = new URLSearchParams({ acc: account, bank: "MB", amount: String(amount), des: reference }).toString();
  return url.href;
}
