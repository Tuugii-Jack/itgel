import 'dotenv/config';
import { z } from 'zod';

/** Хоосон string → undefined (Vercel дээр optional env хоосон байж болно). */
const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(8),
  JWT_CUSTOMER_TTL: z.string().default('30d'),
  JWT_ADMIN_TTL: z.string().default('12h'),

  SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
  SMS_API_URL: z.preprocess(emptyToUndef, z.string().optional()),
  SMS_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  SMS_SENDER: z.string().default('itgel'),

  /** Gmail SMTP — и-мэйл баталгаажуулалт / нууц үг сэргээх. */
  SMTP_HOST: z.preprocess(emptyToUndef, z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.preprocess(emptyToUndef, z.string().optional()),
  SMTP_PASS: z.preprocess(emptyToUndef, z.string().optional()),
  SMTP_FROM: z.preprocess(emptyToUndef, z.string().optional()),

  // --- Supabase ---
  SUPABASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  SUPABASE_PUBLISHABLE_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  SUPABASE_SECRET_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  SUPABASE_JWKS_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  SUPABASE_STORAGE_BUCKET: z.string().default('product-images'),

  /** auto — тохируулсан нь ажиллана (R2 → supabase → mock). Тодорхой заавал болно. */
  STORAGE_PROVIDER: z.enum(['auto', 'r2', 'supabase', 'mock']).default('auto'),

  R2_ENDPOINT: z.preprocess(emptyToUndef, z.string().optional()),
  R2_REGION: z.string().default('us-east-1'),
  R2_BUCKET: z.preprocess(emptyToUndef, z.string().optional()),
  R2_ACCESS_KEY_ID: z.preprocess(emptyToUndef, z.string().optional()),
  R2_SECRET_ACCESS_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  R2_PUBLIC_BASE_URL: z.preprocess(emptyToUndef, z.string().optional()),
  R2_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  CRON_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  ADMIN_EMAIL: z.string().email().default('admin@itgel.mn'),
  ADMIN_PASSWORD: z.string().default('admin123'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Тохиргооны алдаа (.env):\n${issues}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
