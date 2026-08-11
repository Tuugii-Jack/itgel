import app from './app.js';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { startCron, stopCron } from './cron/index.js';
import { activeStorageProvider } from './services/storage.js';
import { ensureStorageBucket, supabaseConfigured } from './services/supabase.js';

/** Vercel дээр listen хийхгүй — platform өөрөө handler авна. */
const onVercel = Boolean(process.env.VERCEL);

if (!onVercel) {
  const server = app.listen(env.PORT, () => {
    console.info(`itgel backend → http://localhost:${env.PORT} (${env.NODE_ENV})`);
    if (env.CRON_ENABLED) startCron();
    const provider = activeStorageProvider();
    console.info(`[storage] provider: ${provider}`);
    if (supabaseConfigured) console.info(`[supabase] ${env.SUPABASE_URL}`);
    if (provider === 'supabase') void ensureStorageBucket();
  });

  async function shutdown(signal: string) {
    console.info(`\n${signal} — зогсоож байна…`);
    stopCron();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
} else {
  // Serverless cold start — bucket/cron-ыг энд хүчээр эхлүүлэхгүй.
  console.info(`[vercel] itgel backend ready (${env.NODE_ENV})`);
}
