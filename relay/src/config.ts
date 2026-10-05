import { z } from "zod";

const optional = z.string().min(1).optional();

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]),
  RELAY_PUBLIC_BASE_URL: z.string().url(),
  // development only: skips real auth on /mcp and /ws
  DEV_USER: optional,
  GOOGLE_WEB_CLIENT_ID: optional,
  GOOGLE_WEB_CLIENT_SECRET: optional,
  EXTENSION_GOOGLE_CLIENT_ID: optional,
  JWT_PRIVATE_KEY: optional,
  DATABASE_URL: optional,
  CREDENTIAL_KEY: optional,
});

type Parsed = z.infer<typeof schema>;

export type Config = Omit<Parsed, "GOOGLE_WEB_CLIENT_ID" | "GOOGLE_WEB_CLIENT_SECRET" | "EXTENSION_GOOGLE_CLIENT_ID" | "JWT_PRIVATE_KEY" | "DATABASE_URL" | "CREDENTIAL_KEY"> & {
  // true only in development with DEV_USER set
  devAuth: boolean;
  // no trailing slash
  baseUrl: string;
  // present whenever devAuth is off
  real: {
    googleClientId: string;
    googleClientSecret: string;
    extensionClientId: string;
    jwtPrivateKey: string;
    databaseUrl: string;
    credentialKey: string;
  } | null;
};

const REAL = ["GOOGLE_WEB_CLIENT_ID", "GOOGLE_WEB_CLIENT_SECRET", "EXTENSION_GOOGLE_CLIENT_ID", "JWT_PRIVATE_KEY", "DATABASE_URL", "CREDENTIAL_KEY"] as const;

function die(problems: string[]): never {
  console.error(`invalid configuration:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // a blank line in .env ("DEV_USER=") means unset, not an empty value
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(set);
  if (!parsed.success) die(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const cfg = parsed.data;

  // the dev bypass must never be reachable in production, even by accident
  if (cfg.NODE_ENV === "production" && cfg.DEV_USER) {
    die(["DEV_USER must not be set when NODE_ENV=production"]);
  }

  const devAuth = cfg.NODE_ENV === "development" && !!cfg.DEV_USER;
  let real: Config["real"] = null;
  if (!devAuth) {
    const missing = REAL.filter((k) => !cfg[k]);
    if (missing.length) die(missing.map((k) => `${k}: required (set DEV_USER with NODE_ENV=development to skip real auth)`));
    real = {
      googleClientId: cfg.GOOGLE_WEB_CLIENT_ID!,
      googleClientSecret: cfg.GOOGLE_WEB_CLIENT_SECRET!,
      extensionClientId: cfg.EXTENSION_GOOGLE_CLIENT_ID!,
      // .env files often hold the PEM on one line with literal \n
      jwtPrivateKey: cfg.JWT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      databaseUrl: cfg.DATABASE_URL!,
      credentialKey: cfg.CREDENTIAL_KEY!,
    };
  }

  return { PORT: cfg.PORT, NODE_ENV: cfg.NODE_ENV, RELAY_PUBLIC_BASE_URL: cfg.RELAY_PUBLIC_BASE_URL, DEV_USER: cfg.DEV_USER, devAuth, baseUrl: cfg.RELAY_PUBLIC_BASE_URL.replace(/\/+$/, ""), real };
}
