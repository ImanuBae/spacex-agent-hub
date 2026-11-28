import pg from "pg";
import { authConfig } from "@spacex/auth";
import { connectBroker, dispatchOutbox } from "@spacex/messaging";
import { createPaymentApp } from "./app.js";
import { sePayConfig } from "./sepay.js";
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(name+" required");return value;};
const pool=new pg.Pool({connectionString:required("DATABASE_URL"),connectionTimeoutMillis:5000});
const fault = process.env.PAYMENT_ADJUSTMENT_FAULT;
if (fault && (process.env.NODE_ENV !== "test" || !["UNKNOWN_BEFORE", "UNKNOWN_AFTER"].includes(fault))) throw new Error("Synthetic adjustment fault requires isolated tests");
const sePay = process.env.PAYMENT_ADAPTER === "sepay" ? sePayConfig.parse({
  account: required("SEPAY_MB_ACCOUNT"), secret: required("SEPAY_WEBHOOK_SECRET"),
}) : undefined;
const server=createPaymentApp(pool,authConfig(),{enrollmentUrl: required("ENROLLMENT_URL"), classUrl: required("CLASS_URL"), sourceClientId: required("SOURCE_CLIENT_ID"), sourceClientSecret: required("SOURCE_CLIENT_SECRET"), reviewOwnerId: required("REVIEW_OWNER_ID"), syntheticWebhookSecret: process.env.SYNTHETIC_PAYMENT_WEBHOOK_SECRET ?? "", adjustmentFault: fault === "UNKNOWN_BEFORE" || fault === "UNKNOWN_AFTER" ? fault : undefined, syntheticEnabled: process.env.NODE_ENV==="test" && process.env.PAYMENT_ADAPTER==="synthetic", sePay, selfRegistrationSecret: process.env.ENROLLMENT_PAYMENT_SECRET, reportingEnabled:process.env.REPORTING_EVENTS_ENABLED==="true"}).listen(Number(process.env.PORT??4009),process.env.HOST??"127.0.0.1");
let broker:Awaited<ReturnType<typeof connectBroker>>|undefined,working=false;
async function tick(){if(working||!process.env.RABBITMQ_URL)return;working=true;try{
 if(broker&&!broker.connected){await broker.close();broker=undefined;}
 broker??=await connectBroker(process.env.RABBITMQ_URL,()=>undefined);
 await dispatchOutbox(pool,event=>broker!.publish(event));
}catch{console.error("payment.outbox_unavailable");}finally{working=false;}}
void tick();const timer=setInterval(()=>void tick(),1000);timer.unref();
for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{clearInterval(timer);server.close(()=>{void(async()=>{while(working)await new Promise(r=>setTimeout(r,20));await broker?.close();await pool.end();process.exit(0);})();});setTimeout(()=>process.exit(1),10000).unref();});
