import { loadConfig } from "@spacex/config";
import { createLogger } from "@spacex/logger";
import { createApp } from "./app.js";
import { registerCatalogRoutes } from "./routes.js";

const config = loadConfig();
const logger = createLogger(config.SERVICE_NAME);
const server = createApp(config.SERVICE_NAME, registerCatalogRoutes).listen(config.PORT, config.HOST, () => {
  logger.info("service.started", { host: config.HOST, port: config.PORT });
});
server.on("error", (error) => {
  logger.error("service.start_failed", { errorName: error.name });
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info("service.stopping", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
