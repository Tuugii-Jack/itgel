import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { issuePhoneOtp, normalizeLoginPhone, PHONE_OTP_ADMIN_PHONE } from './phoneOtp.js';
import { consumeOtpWithStore, prismaOtpWhere, throwOtpClaim, type OtpClaimStore } from '../lib/otpClaim.js';

function adminPhoneStore(phone: string, adminUserId: string): OtpClaimStore {
  return {
    findLatestUnused: () =>
      prisma.phoneOtp.findFirst({
        where: { phone, purpose: PHONE_OTP_ADMIN_PHONE, adminUserId, usedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    tryMarkUsed: async (id, code, now) => {
      const result = await prisma.phoneOtp.updateMany({
        where: { ...prismaOtpWhere(id, now, code), adminUserId },
        data: { usedAt: now },
      });
      return result.count === 1;
    },
    tryCountFailure: async (id, now) => {
      const result = await prisma.phoneOtp.updateMany({
        where: { ...prismaOtpWhere(id, now), adminUserId },
        data: { attempts: { increment: 1 } },
      });
      if (result.count !== 1) return null;
      const row = await prisma.phoneOtp.findUnique({ where: { id }, select: { attempts: true } });
      return row?.attempts ?? null;
    },
  };
}

function assertCanSetPhone(actorRole: string, actorAdminId: string, targetId: string) {
  if (actorRole !== 'ADMIN' && actorAdminId !== targetId) {
    throw forbidden('Энэ дугаарыг солих эрхгүй.');
  }
}

export async function issueAdminLoginPhoneOtp(input: {
  targetAdminId: string;
  phone: string;
  actorAdminId: string;
  actorRole: string;
  ip?: string;
}) {
  const target = await prisma.adminUser.findUnique({ where: { id: input.targetAdminId } });
  if (!target) throw notFound('Админ олдсонгүй.');
  assertCanSetPhone(input.actorRole, input.actorAdminId, target.id);
  const phone = normalizeLoginPhone(input.phone);
  const taken = await prisma.adminUser.findFirst({
    where: { phone, id: { not: target.id } },
    select: { id: true },
  });
  if (taken) throw conflict('Энэ дугаар өөр админы бүртгэлд холбогдсон.');

  return issuePhoneOtp({
    phone,
    ip: input.ip,
    purpose: PHONE_OTP_ADMIN_PHONE,
    adminUserId: target.id,
    previousPhone: target.phone,
  });
}

export async function verifyAdminLoginPhone(input: {
  targetAdminId: string;
  phone: string;
  code: string;
  actorAdminId: string;
  actorRole: string;
}) {
  const target = await prisma.adminUser.findUnique({ where: { id: input.targetAdminId } });
  if (!target) throw notFound('Админ олдсонгүй.');
  assertCanSetPhone(input.actorRole, input.actorAdminId, target.id);
  if (!/^\d{6}$/.test(input.code)) throw badRequest('Код 6 оронтой байна.');
  const phone = normalizeLoginPhone(input.phone);
  const now = new Date();
  const store = adminPhoneStore(phone, target.id);
  throwOtpClaim(await consumeOtpWithStore(store, phone, input.code, now));

  const taken = await prisma.adminUser.findFirst({
    where: { phone, id: { not: target.id } },
    select: { id: true },
  });
  if (taken) throw conflict('Энэ дугаар өөр админы бүртгэлд холбогдсон.');

  const updated = await prisma.adminUser.update({
    where: { id: target.id },
    data: {
      phone,
      phoneVerifiedAt: now,
      tokenVersion: { increment: 1 },
    },
    select: { id: true, email: true, name: true, role: true, isActive: true, phone: true },
  });

  await audit({
    actor: `admin:${input.actorAdminId}`,
    action: 'AUTH_ADMIN_PHONE_SET',
    entity: 'AdminUser',
    entityId: updated.id,
    after: { hasLoginPhone: true },
  });

  return updated;
}
