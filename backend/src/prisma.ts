import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';

/**
 * Serverless дээр холболт дахин дахин нээгдэхээс сэргийлнэ.
 * Vercel + Supabase pooler: connection_limit=1 зөвлөмжтэй.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', '1');
    }
    if (!u.searchParams.has('pool_timeout')) {
      u.searchParams.set('pool_timeout', '10');
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
