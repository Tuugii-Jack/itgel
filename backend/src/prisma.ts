import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';

/**
 * Promise.all (count + findMany, нүүрийн 5 query) нэг instance дээр зэрэг явна.
 * Pooler-ийг дүүргэхгүйн тулд жижиг pool (5). DATABASE_URL-д limit байвал түүнийг үлдээнэ.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const current = Number(u.searchParams.get('connection_limit') ?? '0');
    if (!Number.isFinite(current) || current < 5) {
      u.searchParams.set('connection_limit', '5');
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
