import { z } from "zod";

/**
 * Environment is parsed once, at boot. A malformed value should stop the
 * process immediately rather than surface as a confusing 500 on the first
 * request that happens to touch it.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_URL: z.url().default("http://localhost:3000"),

    ALLOWED_ORIGINS: z.string().default(""),

    // Mode 1: JWKS-backed JWT verification.
    AUTH_JWKS_URL: z.url().optional(),
    AUTH_ISSUER: z.string().min(1).optional(),
    AUTH_AUDIENCE: z.string().min(1).optional(),

    // Mode 2: a static token, development only.
    DEV_AUTH_TOKEN: z.string().min(8).optional(),

    RATE_LIMIT_CAPACITY: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_REFILL_PER_SEC: z.coerce.number().positive().default(1),
    SESSION_IDLE_MS: z.coerce.number().int().positive().default(30 * 60_000),
  })
  .superRefine((env, ctx) => {
    const hasJwks = Boolean(env.AUTH_JWKS_URL);
    const hasDevToken = Boolean(env.DEV_AUTH_TOKEN);

    if (!hasJwks && !hasDevToken) {
      ctx.addIssue({
        code: "custom",
        message: "Set AUTH_JWKS_URL (production) or DEV_AUTH_TOKEN (development).",
      });
    }
    if (hasJwks && (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE)) {
      ctx.addIssue({
        code: "custom",
        message: "AUTH_JWKS_URL requires AUTH_ISSUER and AUTH_AUDIENCE.",
      });
    }
    // An unverified static token must never be reachable in production.
    if (hasDevToken && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        message: "DEV_AUTH_TOKEN cannot be used when NODE_ENV=production.",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(i => `  ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${detail}`);
  }
  return parsed.data;
}

export const config = load();

export const allowedOrigins = new Set(
  config.ALLOWED_ORIGINS.split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

/** True when auth is the static-token development shortcut. */
export const isDevAuth = !config.AUTH_JWKS_URL && Boolean(config.DEV_AUTH_TOKEN);
