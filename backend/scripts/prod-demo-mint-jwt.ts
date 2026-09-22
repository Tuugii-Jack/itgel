/** Writes a short-lived workspace JWT to .backups (gitignored). Does not print the token. */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/env.js';
import { prisma } from '../src/prisma.js';
import { signAdminToken } from '../src/lib/jwt.js';

const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const owner = await prisma.adminUser.findFirst({
    where: { role: 'OWNER', isActive: true },
    select: { id: true, email: true, role: true, tokenVersion: true, name: true },
  });
  const leasing = await prisma.adminUser.findFirst({
    where: { role: 'LEASING', isActive: true },
    select: { id: true, email: true, role: true, tokenVersion: true, name: true },
  });
  if (!owner || !leasing) throw new Error('OWNER/LEASING missing');
  const ownerToken = signAdminToken({
    sub: owner.id,
    email: owner.email,
    role: owner.role,
    tv: owner.tokenVersion,
  });
  const leasingToken = signAdminToken({
    sub: leasing.id,
    email: leasing.email,
    role: leasing.role,
    tv: leasing.tokenVersion,
  });
  writeFileSync(
    join(HERE, '../.backups/DEMO-20260921-A-tokens.json'),
    JSON.stringify({ ownerToken, leasingToken, ownerName: owner.name, leasingName: leasing.name }),
  );
  console.log(JSON.stringify({ ok: true, ownerName: owner.name, leasingName: leasing.name, written: true }));
}

main().finally(() => prisma.$disconnect());
