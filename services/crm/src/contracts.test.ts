import { expect, it } from "vitest";
import { PersonInput, LeadInput, ConsentInput, LeadUpdate, CrmMergeInput, CrmAutomationInput } from "@spacex/contracts";
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
it("binds CRM requests to explicit actions and rejects machine-supplied actor/branch/consent claims", () => {
  const input = { action: "resolve-channel", conversationId: id, contact: { fullName: "DEMO Contact", phone: "090 123 4567" }, createLead: true };
  expect(CrmAutomationInput.parse(input)).toMatchObject({ action: "resolve-channel", contact: { phone: "+84901234567" } });
  for (const field of ["actorId", "branchId", "role", "consentRef", "ownerId"]) expect(CrmAutomationInput.safeParse({ ...input, [field]: id }).success).toBe(false);
  expect(CrmAutomationInput.safeParse({ ...input, consent: true }).success).toBe(false);
  expect(CrmAutomationInput.safeParse({ ...input, consent: { purpose: "MARKETING", status: "GRANTED", statementVersion: "DEMO-v1", statementText: "DEMO marketing", method: "WEB_FORM" } }).success).toBe(false);
  expect(CrmMergeInput.safeParse({ sourceId: id, targetId: id, sourceVersion: 1, targetVersion: 1, resolutions: {} }).success).toBe(false);
});
