/**
 * Production .env-ийг vitest-д ачаалахаас өмнө шалгана.
 * Isolated override байхгүй бол шууд зогсооно — supabase/QPay/SMS руу явахгүй.
 */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)$/i;
const FORBIDDEN = /supabase|pooler\.|amazonaws|merchant\.qpay\.mn|itgelshop|neon\.tech/i;

function redact(value: string) {
  return value.replace(/:[^/@]+@/, ':***@');
}

function hostOf(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function mustBeSet(name: string) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} isolated override байхгүй. Production .env ашиглахгүй.`);
  }
  return value.trim();
}

function mustBeLocalUrl(name: string) {
  const value = mustBeSet(name);
  if (FORBIDDEN.test(value) || !LOCAL_HOST.test(hostOf(value))) {
    throw new Error(`${name} локал/mock биш — зогсоов: ${redact(value)}`);
  }
}

function mustBeEmpty(name: string) {
  const value = process.env[name];
  if (value && value.trim()) {
    throw new Error(`${name} хоосон байх ёстой, production руу чиглэсэн: ${redact(value)}`);
  }
}

function mustEqual(name: string, expected: string) {
  const value = mustBeSet(name);
  if (value !== expected) {
    throw new Error(`${name}=${value}, isolated утга ${expected} байх ёстой.`);
  }
}

mustBeLocalUrl('DATABASE_URL');
mustBeLocalUrl('DIRECT_URL');
mustBeLocalUrl('QPAY_BASE_URL');
mustBeLocalUrl('LEASING_QPAY_BASE_URL');
mustBeLocalUrl('QPAY_CALLBACK_URL');
mustBeLocalUrl('LEASING_QPAY_CALLBACK_URL');
mustEqual('SMS_PROVIDER', 'console');
mustEqual('SHOP_SMS_PROVIDER', 'console');
mustEqual('STORAGE_PROVIDER', 'mock');
mustEqual('CRON_ENABLED', 'false');
mustBeEmpty('SUPABASE_URL');
mustBeEmpty('SUPABASE_SECRET_KEY');
mustBeEmpty('SMTP_HOST');
mustBeEmpty('SMTP_PASS');
mustBeEmpty('R2_ENDPOINT');
mustBeEmpty('R2_SECRET_ACCESS_KEY');
