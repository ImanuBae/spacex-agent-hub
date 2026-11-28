import { createHmac } from "node:crypto";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createApp } from "@spacex/http";
import { sePayPath, sePayQr, sePayTransfer } from "./sepay.js";

const config = { account: "0000000000", secret: "test-secret-".repeat(4) };
const timestamp = () => String(Math.floor(Date.now() / 1000));
const sign = (body: Buffer, at: string) => "sha256=" + createHmac("sha256", config.secret).update(at + ".").update(body).digest("hex");
const fixture = {
  id: 91,
  accountNumber: config.account,
  subAccount: "",
  code: "SX0123ABCDEF01",
  transferType: "in",
  transferAmount: 1000,
};

describe("SePay MB transfer", () => {
  it("authenticates the exact bytes through the app's HTTP parser", async () => {
    const app = createApp("test", routes => {
      routes.post(sePayPath, (req, res) => {
        res.json(sePayTransfer(req.body, req.get("x-sepay-timestamp") ?? "", req.get("x-sepay-signature") ?? "", config));
      });
      routes.post("/json", (req, res) => res.json(req.body));
    }, sePayPath);
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP port");
      const origin = "http://127.0.0.1:" + address.port;
      const body = Buffer.from(JSON.stringify(fixture, null, 2));
      const at = timestamp();
      const headers = { "content-type": "application/json", "x-sepay-timestamp": at, "x-sepay-signature": sign(body, at) };
      const valid = await fetch(origin + sePayPath, { method: "POST", headers, body });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({
        provider: "SEPAY", account: config.account, transactionId: "91",
        reference: fixture.code, amount: 1000, currency: "VND",
      });
      const altered = await fetch(origin + sePayPath, { method: "POST", headers, body: JSON.stringify(fixture) });
      expect(altered.status).toBe(401);
      const ordinary = await fetch(origin + "/json", { method: "POST", headers, body });
      expect(await ordinary.json()).toEqual(fixture);
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("filters unrelated transfers and rejects old signatures", () => {
    const at = timestamp();
    for (const changes of [{ accountNumber: "0000000001" }, { transferType: "out" }, { code: null }, { subAccount: "VA123" }]) {
      const body = Buffer.from(JSON.stringify({ ...fixture, ...changes }));
      expect(sePayTransfer(body, at, sign(body, at), config)).toBeNull();
    }
    const old = String(Number(at) - 301);
    const body = Buffer.from(JSON.stringify(fixture));
    expect(() => sePayTransfer(body, old, sign(body, old), config)).toThrow("SePay webhook authentication failed");
  });

  it("acknowledges the signed dashboard sample without recording a transfer", () => {
    const at = timestamp();
    const body = Buffer.from(JSON.stringify({ ...fixture, id: 0 }));
    expect(sePayTransfer(body, at, sign(body, at), config)).toBeNull();
    expect(() => sePayTransfer(body, at, "", config)).toThrow("SePay webhook authentication failed");
  });

  it("encodes the MB account, exact amount and order reference", () => {
    const url = new URL(sePayQr(config.account, fixture.transferAmount, fixture.code));
    expect(url.origin).toBe("https://vietqr.app");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      acc: config.account, bank: "MB", amount: "1000", des: fixture.code,
    });
  });
});
