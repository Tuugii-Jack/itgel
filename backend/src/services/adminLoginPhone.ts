import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { canManageOtherAdminPhones } from '../lib/adminRoles.js';
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
  if (!canManageOtherAdminPhones(actorRole) && actorAdminId !== targetId) {
    throw forbidden('Энэ дугаарыг нэмэх эрхгүй.');
  }
}

async function assertPhoneAvailable(phone: string, targetId: string) {
  const takenLogin = await prisma.adminLoginPhone.findUnique({
    where: { phone },
    select: { adminUserId: true },
  });
  if (takenLogin?.adminUserId === targetId) {
    throw conflict('Энэ дугаар аль хэдийн холбогдсон.');
  }
  if (takenLogin) {
    throw conflict('Энэ дугаар өөр админы бүртгэлд холбогдсон.');
  }
  const takenLegacy = await prisma.adminUser.findFirst({
    where: { phone, id: { not: targetId } },
    select: { id: true },
  });
  if (takenLegacy) throw conflict('Энэ дугаар өөр админы бүртгэлд холбогдсон.');
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
  await assertPhoneAvailable(phone, target.id);

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
  const target = await prisma.adminUser.findUnique({
    where: { id: input.targetAdminId },
    include: { loginPhones: { select: { phone: true } } },
  });
  if (!target) throw notFound('Админ олдсонгүй.');
  assertCanSetPhone(input.actorRole, input.actorAdminId, target.id);
  if (!/^\d{6}$/.test(input.code)) throw badRequest('Код 6 оронтой байна.');
  const phone = normalizeLoginPhone(input.phone);
  const now = new Date();
  const store = adminPhoneStore(phone, target.id);
  throwOtpClaim(await consumeOtpWithStore(store, phone, input.code, now));
  await assertPhoneAvailable(phone, target.id);

  await prisma.adminLoginPhone.create({
    data: {
      adminUserId: target.id,
      phone,
      verifiedAt: now,
    },
  });

  const updated = await prisma.adminUser.update({
    where: { id: target.id },
    data: target.phone
      ? {}
      : {
          phone,
          phoneVerifiedAt: now,
        },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      phone: true,
      loginPhones: { select: { phone: true }, orderBy: { createdAt: 'asc' } },
    },
  });

  await audit({
    actor: `admin:${input.actorAdminId}`,
    action: 'AUTH_ADMIN_PHONE_ADD',
    entity: 'AdminUser',
    entityId: updated.id,
    after: { phoneCount: updated.loginPhones.length },
  });

  return updated;
}
