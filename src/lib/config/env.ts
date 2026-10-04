import { z } from "zod";

function isPublicOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const optionalValue = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

function isPostgresUrl(value: string): boolean {
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** Upgrade the Marketplace default only when the operator explicitly requires verified TLS. */
function verifiedNeonUrl(value: string): string {
  try {
    const url = new URL(value);
    const modes = url.searchParams.getAll("sslmode");
    if (url.hostname.endsWith(".neon.tech") && modes.length === 1 && modes[0] === "require") {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
  } catch { /* The schema reports malformed values without exposing credentials. */ }
  return value;
}

const booleanSetting = (defaultValue: "true" | "false") =>
  z.enum(["true", "false"]).default(defaultValue).transform((value) => value === "true");

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .refine(isPublicOrigin)
    .default("http://localhost:3000"),
  DATABASE_URL: optionalValue(z.url().refine(isPostgresUrl)),
  VERCEL: optionalValue(z.literal("1")),
  DB_POOL_MAX: optionalValue(z.coerce.number().int().min(1).max(20)),
  CRON_SECRET: optionalValue(z.string().regex(/^[A-Za-z0-9_-]{32,256}$/)),
  DATABASE_SSL_MODE: optionalValue(z.enum(["verify-full"])),
  REALTIME_DATABASE_URL: optionalValue(z.url().refine(isPostgresUrl)),
  REALTIME_ENABLED: booleanSetting("true"),
  BETA_SIGNUPS_ENABLED: booleanSetting("true"),
  BETA_SEEKING_ENABLED: booleanSetting("true"),
  BETA_READ_ONLY: booleanSetting("false"),
  RATE_LIMIT_BACKEND: optionalValue(z.enum(["memory", "postgres"])),
  MODERATION_ADMIN_SECRET: optionalValue(z.string().regex(/^[A-Za-z0-9_-]{32,256}$/)),
  PUSH_VAPID_PUBLIC_KEY: optionalValue(z.string().regex(/^[A-Za-z0-9_-]{87}$/)),
  PUSH_VAPID_PRIVATE_KEY: optionalValue(z.string().regex(/^[A-Za-z0-9_-]{43}$/)),
  PUSH_VAPID_SUBJECT: optionalValue(z.string().refine((value) => {
    if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return true;
    return isPublicOrigin(value) && new URL(value).protocol === "https:";
  })),
  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: optionalValue(z.string().trim().min(1)),
  OPENAI_MODEL: optionalValue(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]+$/)
      .max(80),
  ),
  ANALYTICS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
}).superRefine((env, context) => {
  if (env.NODE_ENV === "production") {
    const origin = new URL(env.NEXT_PUBLIC_APP_URL);
    if (origin.protocol !== "https:" && !isLoopback(origin.hostname)) {
      context.addIssue({ code: "custom", path: ["NEXT_PUBLIC_APP_URL"], message: "Invalid origin" });
    }
    for (const field of ["DATABASE_URL", "REALTIME_DATABASE_URL"] as const) {
      const value = env[field];
      if (!value || !isPostgresUrl(value)) continue;
      const url = new URL(value);
      const modes = url.searchParams.getAll("sslmode");
      const hosts = [url.hostname,...url.searchParams.getAll("host")];
      const ssl = url.searchParams.getAll("ssl");
      if (hosts.some(host=>!isLoopback(host)) && (modes.some(mode=>mode!=="verify-full") || ssl.some(value=>value==="0"||value==="false"))) {
        context.addIssue({ code: "custom", path: [field], message: "Invalid TLS mode" });
      }
    }
  }
  if (env.VERCEL === "1" && env.REALTIME_DATABASE_URL && isPostgresUrl(env.REALTIME_DATABASE_URL)) {
    const host = new URL(env.REALTIME_DATABASE_URL).hostname;
    if (host.endsWith(".neon.tech") && host.includes("-pooler.")) {
      context.addIssue({ code: "custom", path: ["REALTIME_DATABASE_URL"], message: "Realtime requires a direct connection" });
    }
  }
  const pushFields = ["PUSH_VAPID_PUBLIC_KEY", "PUSH_VAPID_PRIVATE_KEY", "PUSH_VAPID_SUBJECT"] as const;
  if (pushFields.some((field) => env[field])) {
    for (const field of pushFields) {
      if (!env[field]) context.addIssue({ code: "custom", path: [field], message: "Missing push configuration" });
    }
  }
}).transform((env) => ({
  ...env,
  DB_POOL_MAX: env.DB_POOL_MAX ?? (env.VERCEL === "1" ? 2 : 5),
  DATABASE_SSL_MODE: env.DATABASE_SSL_MODE ?? (env.NODE_ENV === "production" && [env.DATABASE_URL,env.REALTIME_DATABASE_URL].some(value=>{
    if(!value)return false;const url=new URL(value);return [url.hostname,...url.searchParams.getAll("host")].some(host=>!isLoopback(host));
  }) ? "verify-full" as const : undefined),
  RATE_LIMIT_BACKEND: env.RATE_LIMIT_BACKEND ?? (env.NODE_ENV === "production" ? "postgres" : "memory"),
}));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Pure parser. Errors name invalid fields and never repeat secret values. */
export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const configured = { ...source };
  if (source.VERCEL === "1") {
    // Marketplace secret values remain server-side; LISTEN must bypass its transaction pooler.
    if (!configured.REALTIME_DATABASE_URL && source.DATABASE_URL_UNPOOLED) {
      configured.REALTIME_DATABASE_URL = source.DATABASE_URL_UNPOOLED;
    }
    if (source.DATABASE_SSL_MODE === "verify-full") {
      for (const field of ["DATABASE_URL", "REALTIME_DATABASE_URL"] as const) {
        if (configured[field]) configured[field] = verifiedNeonUrl(configured[field]);
      }
    }
  }
  const result = serverEnvSchema.safeParse(configured);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Invalid environment configuration: ${fields.join(", ")}. Check .env.example.`,
    );
  }
  return result.data;
}
