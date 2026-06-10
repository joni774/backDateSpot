import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z
    .string()
    .default("*")
    .describe("Origins for web clients (optional). Comma-separated; * in dev."),
  SENDGRID_API_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(
      "Invalid environment configuration:\n" +
        missing +
        "\n\nCopy .env.example to .env and fill in the required values."
    );
    process.exit(1);
  }

  return result.data;
}

export const env: Env = parseEnv();
