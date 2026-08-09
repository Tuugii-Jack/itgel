import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

export type Actor = string; // "admin:<id>" | "customer:<id>" | "system"

export interface AuditInput {
  actor: Actor;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

type Client = Pick<typeof prisma, 'auditLog'>;

/** Бараа, захиалга, тохиргооны бүх өөрчлөлтийг тэмдэглэнэ. */
export async function audit(input: AuditInput, client: Client = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: toJson(input.before),
      after: toJson(input.after),
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
