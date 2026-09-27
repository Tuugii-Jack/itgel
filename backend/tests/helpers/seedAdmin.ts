import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/prisma.js';
import { signAdminToken } from '../../src/lib/jwt.js';
import type { AdminRoleName } from '../../src/lib/adminRoles.js';

function token(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

function digits(raw: string, len: number): string {
  const n = raw.replace(/[a-f]/g, '1').replace(/\D/g, '2').slice(0, len);
  return n.padEnd(len, '0');
}

export async function seedAdmin(role: AdminRoleName = 'STAFF') {
  const t = token();
  const admin = await prisma.adminUser.create({
    data: {
      email: `${role.toLowerCase()}-${t}@itgel.test`,
      name: `${role} ${t}`,
      passwordHash: 'x',
      role,
      phoneVerifiedAt: new Date(),
      loginPhones: {
        create: {
          phone: `8${digits(t, 7)}`,
          verifiedAt: new Date(),
        },
      },
    },
  });
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
  const customer = await prisma.customer.create({
    data: { phone: `9${digits(t, 7)}`, name: `Cust ${t}` },
  });
  return { category, product, round, customer, t };
}
