import { z } from "zod";

/**
 * Boot-time environment validation (bible §12 money/safety discipline; matches
 * the user's kylx `@kylx/config` Zod pattern). Backend services call
 * `loadEnv()` once at startup; a missing/invalid var fails fast and loud.
 *
 * Secrets are read from process.env (populated by `node --env-file=.env` or
 * docker-compose). Never hard-code them.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // infra
  DATABASE_URL: z.string().url().default("postgres://caesar:caesar@localhost:55432/caesar"),
  REDIS_URL: z.string().url().default("redis://localhost:56379"),
  TEMPORAL_ADDRESS: z.string().default("localhost:57233"),

  // Privy (Spike C)
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),

  // Polygon / Polymarket (Spike A)
  POLYGON_RPC_HTTP: z.string().url().default("https://polygon-rpc.com"),
  AMOY_RPC_HTTP: z.string().url().default("https://rpc-amoy.polygon.technology"),
  AMOY_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x-prefixed 32-byte hex private key")
    .optional(),
  POLYMARKET_CLOB_URL: z.string().url().default("https://clob.polymarket.com"),

  // Kalshi (Spike B — optional until demo creds provisioned)
  KALSHI_API_BASE: z.string().url().default("https://demo-api.kalshi.co"),
  KALSHI_API_KEY_ID: z.string().min(1).optional(),
  KALSHI_PRIVATE_KEY_PEM: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parse + validate process.env once. Throws a readable error on misconfig. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clear the memoized env. */
export function __resetEnvCache(): void {
  cached = undefined;
}
