import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';
import { addDbQuery } from './lib/requestTiming.js';

/**
 * Promise.all нэг instance дээр зэрэг явна.
 * URL дээрх connection_limit 5-аас бага бол 5 болгоно. Тоог энд нэмэхгүй.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const queryTiming = process.env.PRISMA_QUERY_TIMING === '1';

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

const resolvedDatasourceUrl = datasourceUrl();

function connectionLimitOf(url: string | undefined): number | null {
  if (!url) return null;
  try {
    const value = Number(new URL(url).searchParams.get('connection_limit'));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function withQueryTiming(client: PrismaClient): PrismaClient {
  const timed = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const started = Date.now();
          try {
            return await query(args);
          } finally {
            addDbQuery(Date.now() - started);
          }
        },
      },
      async $queryRaw({ args, query }) {
        const started = Date.now();
        try {
          return await query(args);
        } finally {
          addDbQuery(Date.now() - started);
        }
      },
      async $executeRaw({ args, query }) {
        const started = Date.now();
        try {
          return await query(args);
        } finally {
          addDbQuery(Date.now() - started);
        }
      },
    },
  });
  return timed as unknown as PrismaClient;
}

const createdPrisma = !globalForPrisma.prisma;

export const prisma =
  globalForPrisma.prisma ??
  withQueryTiming(
    new PrismaClient({
      log: queryTiming
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : ['warn', 'error'],
      datasources: { db: { url: resolvedDatasourceUrl } },
    }),
  );

if (createdPrisma) {
  if (queryTiming) {
    (
      prisma as unknown as {
        $on: (event: 'query', cb: (e: { duration: number }) => void) => void;
      }
    ).$on('query', (event) => {
      console.info(`[prisma] ${event.duration}ms`);
    });
  }
  console.info(`[prisma] connection_limit=${connectionLimitOf(resolvedDatasourceUrl) ?? 'default'}`);
}

if (!isProd) globalForPrisma.prisma = prisma;

// Prod serverless дээр ч warm instance дахин ашиглана.
globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
