import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';

/**
 * Serverless (Vercel): instance бүрт connection_limit=1 — pooler-ийг дүүргэхгүй.
 * Local long-running: Promise.all + cron зэрэг query хийдэг тул жижиг pool хэрэгтэй.
 * (limit=1 үед P2024 «Timed out fetching a new connection» гардаг.)
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', isProd ? '1' : '5');
    }
    if (!u.searchParams.has('pool_timeout')) {
      u.searchParams.set('pool_timeout', isProd ? '10' : '20');
    }
    return u.toString();
  } catch {
    return url;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: datasourceUrl() } },
  });

if (!isProd) globalForPrisma.prisma = prisma;

// Prod serverless дээр ч warm instance дахин ашиглана.
globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
