import pg from "pg";
import { authConfig } from "@spacex/auth";
import { connectBroker, dispatchOutbox } from "@spacex/messaging";
import { createPaymentApp } from "./app.js";
const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(name+" required");return value;};
const pool=new pg.Pool({connectionString:required("DATABASE_URL"),connectionTimeoutMillis:5000});
const server=createPaymentApp(pool,authConfig(),{enrollmentUrl: required("ENROLLMENT_URL"), classUrl: required("CLASS_URL"), sourceClientId: required("SOURCE_CLIENT_ID"), sourceClientSecret: required("SOURCE_CLIENT_SECRET"), reviewOwnerId: required("REVIEW_OWNER_ID"), syntheticWebhookSecret: process.env.SYNTHETIC_PAYMENT_WEBHOOK_SECRET ?? "", syntheticEnabled: process.env.NODE_ENV==="test" && process.env.PAYMENT_ADAPTER==="synthetic"}).listen(Number(process.env.PORT??4009),process.env.HOST??"127.0.0.1");
let broker:Awaited<ReturnType<typeof connectBroker>>|undefined,working=false;
async function tick(){if(working||!process.env.RABBITMQ_URL)return;working=true;try{
 if(broker&&!broker.connected){await broker.close();broker=undefined;}
 broker??=await connectBroker(process.env.RABBITMQ_URL,()=>undefined);
 await dispatchOutbox(pool,event=>broker!.publish(event));
}catch{console.error("payment.outbox_unavailable");}finally{working=false;}}
void tick();const timer=setInterval(()=>void tick(),1000);timer.unref();
for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{clearInterval(timer);server.close(()=>{void(async()=>{while(working)await new Promise(r=>setTimeout(r,20));await broker?.close();await pool.end();process.exit(0);})();});setTimeout(()=>process.exit(1),10000).unref();});
