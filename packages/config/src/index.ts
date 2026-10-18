import { z } from "zod";

export const ServiceConfig = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_NAME: z.string().trim().min(1).default("service-template"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  return ServiceConfig.parse(env);
}
