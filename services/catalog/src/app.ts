import { createApp as createHttpApp } from "@spacex/http";
import type { Express } from "express";

export { HttpError } from "@spacex/http";

// Keep the Catalog entry point while sharing trace, metrics and error contracts.
export function createApp(service: string, registerRoutes?: (app: Express) => void) {
  return createHttpApp(service, app => registerRoutes?.(app));
}
