/**
 * Migration-ыг transaction дотор туршиж, ҮРГЭЛЖ буцаана (rollback).
 *
 *   npx tsx scripts/try-migration.ts <migration.sql-ийн зам>
 *
 * Postgres-ийн DDL нь transaction-д багтдаг тул бодит өгөгдөл дээр
 * "юу болохыг" аюулгүйгээр харж болно. Энэ скрипт юуг ч бичихгүй.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const arg = process.argv[2];
if (!arg) {
  console.error('Хэрэглээ: npx tsx scripts/try-migration.ts <migration.sql>');
  process.exit(1);
}
const file: string = arg;

// Migrate нь pooler биш шууд холболт шаарддаг (DDL, advisory lock).
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** `--` тайлбарыг хасаад `;`-ээр салгана. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

class Rollback extends Error {}

async function main(): Promise<void> {
  const sql = readFileSync(file, 'utf8');
  const parts = statements(sql);
  console.info(`${parts.length} SQL мэдэгдэл олдлоо.\n`);

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const [i, statement] of parts.entries()) {
          const label = (statement.split('\n')[0] ?? '').slice(0, 70);
          await tx.$executeRawUnsafe(statement);
          console.info(`  ${i + 1}. ✓ ${label}`);
        }

        console.info('\n--- Үр дүн (transaction дотор) ---');
        const checks = await Promise.all([
          tx.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM "ProductRound"'),
          tx.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM "OrderItem"'),
          tx.$queryRawUnsafe<{ n: bigint }[]>(
            'SELECT count(*) AS n FROM "OrderItem" WHERE "roundId" IS NULL',
          ),
          tx.$queryRawUnsafe<{ n: bigint }[]>(
            'SELECT count(*) AS n FROM "OrderItem" WHERE "arriveTo" IS NOT NULL',
          ),
          tx.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM "Product"'),
        ]);
        const [rounds = 0, items = 0, orphan = 0, dated = 0, products = 0] = checks.map(
          (r) => Number(r[0]?.n ?? 0),
        );

        console.info(`  Бараа (загвар):        ${products}`);
        console.info(`  Тойрог:                ${rounds}`);
        console.info(`  Захиалгын мөр:         ${items}`);
        console.info(`  Тойрогт холбогдоогүй:  ${orphan}   ← 0 байх ёстой`);
        console.info(`  Огноо царцсан мөр:     ${dated}`);

        if (orphan > 0) throw new Error('Зарим мөр тойрогт холбогдсонгүй!');
        if (rounds !== products) throw new Error('Тойргийн тоо бараатай таарсангүй!');

        throw new Rollback();
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) {
      console.info('\n✓ Туршилт амжилттай. Өөрчлөлтийг буцаалаа — өгөгдөл хэвээр.');
      return;
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error('\n✗ Амжилтгүй:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
