import {expect,it} from "vitest";
import {RegistrationTrigger,EnrollmentConfirmedEvent,PaymentReceivedEvent} from "./enrollment.js";
const id="10000000-0000-4000-8000-000000000001";
const header={id,type:"payment.matched",version:1,occurredAt:new Date().toISOString(),correlationId:id};
it("registration ingress is reference-only and cannot smuggle actor/amount/paid declarations",()=>{
  const payload={entity:{type:"enrollment",id},contextRef:id,inputRef:id};
  expect(RegistrationTrigger.safeParse({...header,payload}).success).toBe(true);
  for(const authority of [{actorId:id},{branchId:id},{paid:true},{amount:1}])expect(RegistrationTrigger.safeParse({...header,payload:{...payload,...authority}}).success).toBe(false);
  expect(RegistrationTrigger.safeParse({...header,type:"payment.succeeded",payload}).success).toBe(false);
});
it("received money cannot be confused with a committed enrollment confirmation",()=>{
  const received={...header,type:"payment.received",payload:{ledgerId:id,paymentId:id,amount:100000,currency:"VND",adapter:"SYNTHETIC"}};
  expect(PaymentReceivedEvent.safeParse(received).success).toBe(true);
  expect(EnrollmentConfirmedEvent.safeParse({...received,type:"enrollment.confirmed"}).success).toBe(false);
  expect(PaymentReceivedEvent.safeParse({...received,payload:{...received.payload,amount:0}}).success).toBe(false);
});
