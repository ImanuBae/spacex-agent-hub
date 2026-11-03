import { loadConfig } from "@spacex/config";
import { authConfig } from "@spacex/auth";
import { createGatewayApp } from "./app.js";
const config = loadConfig({ ...process.env, SERVICE_NAME: "gateway", PORT: process.env.PORT ?? "4000" });
const server = createGatewayApp(authConfig(), { catalog: process.env.CATALOG_URL ?? "http://127.0.0.1:4001", org: process.env.ORG_URL ?? "http://127.0.0.1:4003", classes: process.env.CLASS_URL ?? "http://127.0.0.1:4004", crm: process.env.CRM_URL ?? "http://127.0.0.1:4005" }).listen(config.PORT, config.HOST);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
