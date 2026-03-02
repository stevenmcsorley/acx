import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(16).default("change-this-secret-now"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  TELEMETRY_HZ: z.coerce.number().min(10).max(30).default(20),
  SIMULATION_MAX_DRONES: z.coerce.number().min(1).max(500).default(200),
  DEFAULT_ADMIN_EMAIL: z.string().email().default("admin@sgcx.local"),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  MAVLINK_ENABLED: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("false"),
  MAVLINK_CONNECTION_STRING: z.string().default("udp:14550")
});

export const env = envSchema.parse(process.env);
