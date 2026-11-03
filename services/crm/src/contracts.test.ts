import { expect, it } from "vitest";
import { PersonInput, LeadInput, ConsentInput, LeadUpdate } from "@spacex/contracts";
const id = "10000000-0000-4000-8000-000000000002";
it("normalizes contact data without claiming verification or consent", () => {
  expect(PersonInput.parse({ branchId: id, kind: "CONTACT", fullName: "DEMO Contact", phone: "090 123 4567" }).phone).toBe("+84901234567");
  expect(PersonInput.safeParse({ branchId: id, kind: "CONTACT", fullName: "DEMO Contact" }).success).toBe(false);
  expect(PersonInput.safeParse({ branchId: id, kind: "CONTACT", fullName: "DEMO Contact", phone: "0901234567", verified: true }).success).toBe(false);
});
it("rejects forged enrollment states, actor fields and incomplete consent evidence", () => {
  expect(LeadInput.safeParse({ branchId: id, contactId: id, source: "PHONE", stage: "ENROLLED" }).success).toBe(false);
  expect(LeadUpdate.safeParse({ version: 1, stage: "ENROLLED", ownerId: null, notes: "" }).success).toBe(false);
  expect(ConsentInput.safeParse({ purpose: "MARKETING", status: "GRANTED" }).success).toBe(false);
});
