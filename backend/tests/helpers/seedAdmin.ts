import { randomInt, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/prisma.js';
import { signAdminToken } from '../../src/lib/jwt.js';
import type { AdminRoleName } from '../../src/lib/adminRoles.js';

function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

async function createWithPhone<T>(prefix: string, create: (phone: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const phone = `${prefix}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    try {
      return await create(phone);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' ||
          !Array.isArray(error.meta?.target) || !error.meta.target.includes('phone')) throw error;
    }
  }
  throw new Error('Тестийн давхцахгүй утасны дугаар үүсгэж чадсангүй.');
}

export async function seedAdmin(role: AdminRoleName = 'STAFF') {
  const t = token();
  const admin = await createWithPhone('8', (phone) => prisma.adminUser.create({
    data: {
      email: `${role.toLowerCase()}-${t}@itgel.test`,
      name: `${role} ${t}`,
      passwordHash: 'x',
      role,
      phoneVerifiedAt: new Date(),
      loginPhones: {
        create: {
          phone,
          verifiedAt: new Date(),
        },
      },
    },
  }));
  const jwt = signAdminToken({
    sub: admin.id,
    email: admin.email,
    role,
    tv: admin.tokenVersion,
  });
  return { admin, jwt, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } };
}

export async function seedCatalog() {
  const t = token();
  const category = await prisma.category.create({ data: { name: `cat-${t}` } });
  const product = await prisma.product.create({
    data: { name: `p-${t}`, categoryId: category.id },
  });
  const round = await prisma.productRound.create({
    data: {
      productId: product.id,
      roundNo: 1,
      costPrice: 10_000,
      sellPrice: 20_000,
      status: 'ACTIVE',
    },
  });
  const customer = await createWithPhone('9', (phone) => prisma.customer.create({
    data: { phone, name: `Cust ${t}` },
  }));
  return { category, product, round, customer, t };
}
