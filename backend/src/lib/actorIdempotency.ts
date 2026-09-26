import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { conflict } from './errors.js';
import { readCheckoutIdempotencyKey } from './checkoutIdempotency.js';

export function readActorIdempotencyKey(
  header: string | string[] | undefined,
  bodyKey?: string,
): string {
  const key = readCheckoutIdempotencyKey(header, bodyKey);
  if (!key) throw conflict('Idempotency-Key заавал байна.');
  return key;
}

export function hashActorPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function loadActorIdempotency(
  tx: Prisma.TransactionClient,
  input: { kind: string; actorId: string; key: string },
) {
  return tx.actorIdempotency.findUnique({
    where: {
      kind_actorId_idempotencyKey: {
        kind: input.kind,
        actorId: input.actorId,
        idempotencyKey: input.key,
      },
    },
  });
}

export async function beginActorIdempotency(
  tx: Prisma.TransactionClient,
  input: { kind: string; actorId: string; key: string; payloadHash: string },
): Promise<{ record: { id: string; payloadHash: string; response: unknown }; created: boolean }> {
  const existing = await loadActorIdempotency(tx, input);
  if (existing) {
    if (existing.payloadHash !== input.payloadHash) {
      throw conflict('Энэ Idempotency-Key өөр хүсэлтэд ашиглагдсан.', {
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
    return { record: existing, created: false };
  }
  const record = await tx.actorIdempotency.create({
    data: {
      kind: input.kind,
      actorId: input.actorId,
      idempotencyKey: input.key,
      payloadHash: input.payloadHash,
    },
  });
  return { record, created: true };
}
