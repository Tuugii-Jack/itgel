/**
 * Локал/isolated баазад OWNER бүртгэл үүсгэж, OWNER_LOGIN_PHONE-г холбоно.
 * Production, алсын DB, жинхэнэ SMS — ажиллуулахгүй.
 * Дугаарыг кодонд бичихгүй.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url);
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const phone = digits.startsWith('976') && digits.length === 11 ? digits.slice(3) : digits;
  if (!/^\d{8}$/.test(phone)) {
    throw new Error('OWNER_LOGIN_PHONE 8 оронтой байх ёстой.');
  }
  return phone;
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (process.env.NODE_ENV === 'production' || !isLocalUrl(url)) {
    console.error('Зөвхөн локал бааз дээр OWNER холбоно.');
    process.exit(1);
  }
  const phone = normalizePhone(process.env.OWNER_LOGIN_PHONE ?? '');
  const now = new Date();

  const taken = await prisma.adminLoginPhone.findUnique({
    where: { phone },
    include: { admin: { select: { id: true, email: true, role: true } } },
  });
  if (taken && taken.admin.role !== 'OWNER') {
    console.error('Энэ дугаар өөр админы бүртгэлд холбогдсон. Тааж нэгтгэхгүй.');
    process.exit(1);
  }

  const legacy = await prisma.adminUser.findFirst({
    where: { phone },
    select: { id: true, email: true, role: true },
  });
  if (legacy && legacy.role !== 'OWNER') {
    console.error('Энэ дугаар өөр админы бүртгэлд холбогдсон. Тааж нэгтгэхгүй.');
    process.exit(1);
  }

  let owner =
    taken?.admin.role === 'OWNER'
      ? await prisma.adminUser.findUnique({ where: { id: taken.admin.id } })
      : await prisma.adminUser.findFirst({ where: { role: 'OWNER' } });

  if (!owner) {
    const emailTaken = await prisma.adminUser.findUnique({
      where: { email: 'owner@itgel.mn' },
      select: { id: true, role: true },
    });
    if (emailTaken && emailTaken.role !== 'OWNER') {
      console.error('owner@itgel.mn өөр эрхтэй. Тааж нэгтгэхгүй.');
      process.exit(1);
    }
    owner = emailTaken
      ? await prisma.adminUser.findUnique({ where: { id: emailTaken.id } })
      : await prisma.adminUser.create({
          data: {
            email: 'owner@itgel.mn',
            name: 'Эзэмшигч',
            passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
            role: 'OWNER',
            phone,
            phoneVerifiedAt: now,
          },
        });
  } else if (!owner.phone) {
    await prisma.adminUser.update({
      where: { id: owner.id },
      data: { phone, phoneVerifiedAt: now, isActive: true },
    });
  } else if (!owner.isActive) {
    await prisma.adminUser.update({
      where: { id: owner.id },
      data: { isActive: true },
    });
  }

  if (!owner) {
    console.error('OWNER бүртгэл үүсгэж чадсангүй.');
    process.exit(1);
  }

  if (!taken) {
    await prisma.adminLoginPhone.create({
      data: {
        adminUserId: owner.id,
        phone,
        verifiedAt: now,
      },
    });
  }

  console.info('OWNER нэвтрэх дугаар холбогдлоо.', { adminId: owner.id, role: 'OWNER' });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
