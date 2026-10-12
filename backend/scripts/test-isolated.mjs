import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.ITGEL_TEST_DATABASE_URL;
let database;
try { database = new URL(databaseUrl); } catch { /* Checked below. */ }
if (!database || !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost'].includes(database.hostname)) {
  console.error('ITGEL_TEST_DATABASE_URL-д тусдаа локал PostgreSQL тестийн сан заана уу.');
  process.exit(1);
}

const backend = new URL('../', import.meta.url);
const testEnv = { ...process.env, NODE_ENV: 'test' };
// .env дахь үйлчилгээний түлхүүрүүд dotenv-оор тестэд нэвтрэхээс хамгаална.
const source = readFileSync(new URL('src/env.ts', backend), 'utf8');
for (const [, name] of source.matchAll(/^  ([A-Z][A-Z0-9_]+):/gm)) {
  if (/^(SMS_|SHOP_SMS_|SMTP_|SUPABASE_|R2_|QPAY_|LEASING_QPAY_)/.test(name)) testEnv[name] = '';
}
Object.assign(testEnv, {
  DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
  JWT_SECRET: 'isolated-test-secret', CRON_SECRET: 'isolated-test-cron',
  SMS_PROVIDER: 'console', SHOP_SMS_PROVIDER: 'console', STORAGE_PROVIDER: 'mock', CRON_ENABLED: 'false',
  SMTP_PORT: '465', QPAY_ENABLED: 'false', LEASING_QPAY_ENABLED: 'false',
  QPAY_BASE_URL: 'http://127.0.0.1:9/v2', LEASING_QPAY_BASE_URL: 'http://127.0.0.1:9/v2',
  QPAY_CALLBACK_URL: 'http://127.0.0.1:9/api/orders/qpay/callback',
  LEASING_QPAY_CALLBACK_URL: 'http://127.0.0.1:9/api/orders/leasing-qpay/callback',
  ADMIN_EMAIL: 'test@itgel.test', ADMIN_PASSWORD: 'isolated-test-only',
});
const child = spawn(process.execPath, [fileURLToPath(new URL('node_modules/vitest/vitest.mjs', backend)),
  'run', '--fileParallelism', 'false', ...process.argv.slice(2)], {
  cwd: fileURLToPath(backend), env: testEnv, stdio: 'inherit',
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
