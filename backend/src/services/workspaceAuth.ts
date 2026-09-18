import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { signAdminToken } from '../lib/jwt.js';
import { normalizeLoginPhone } from './phoneOtp.js';

export type WorkspaceUser = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF' | 'LEASING';
};

export type WorkspaceSession = {
  token: string;
  user: WorkspaceUser;
};

export async function peekWorkspace(phoneRaw: string | null | undefined): Promise<WorkspaceUser | null> {
  const trimmed = String(phoneRaw || '').trim();
  if (!trimmed) return null;
  let phone: string;
  try {
    phone = normalizeLoginPhone(trimmed);
  } catch {
    return null;
  }
  const admin = await prisma.adminUser.findFirst({
    where: {
      phone,
      phoneVerifiedAt: { not: null },
      isActive: true,
    },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!admin) return null;
  return publicWorkspaceUser(admin);
}

function publicWorkspaceUser(user: {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF' | 'LEASING';
}): WorkspaceUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * OTP баталгаажсаны ДАРАА л дуудна.
 * Идэвхгүй/утас баталгаажаагүй админд session өгөхгүй.
 * Клиентийн role/adminId-г уншихгүй.
 */
export async function openWorkspaceSession(
  phoneRaw: string,
  actor = 'system:otp',
): Promise<WorkspaceSession | null> {
  const phone = normalizeLoginPhone(phoneRaw);
  const admin = await prisma.adminUser.findFirst({
    where: {
      phone,
      phoneVerifiedAt: { not: null },
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tokenVersion: true,
    },
  });
  if (!admin) return null;

  const updated = await prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      lastLoginAt: new Date(),
      tokenVersion: { increment: 1 },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tokenVersion: true,
    },
  });

  await audit({
    actor,
    action: 'AUTH_WORKSPACE_LOGIN',
    entity: 'AdminUser',
    entityId: updated.id,
    after: { role: updated.role },
  });

  return {
    token: signAdminToken({
      sub: updated.id,
      email: updated.email,
      role: updated.role,
      tv: updated.tokenVersion,
    }),
    user: publicWorkspaceUser(updated),
  };
}

export async function revokeWorkspaceSessions(adminId: string, actor: string): Promise<void> {
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { tokenVersion: { increment: 1 } },
  });
  await audit({
    actor,
    action: 'AUTH_WORKSPACE_REVOKE',
    entity: 'AdminUser',
    entityId: adminId,
  });
}

export function auditAdminPhones(rows: { id: string; phone: string | null; phoneVerifiedAt: Date | null; isActive: boolean }[]) {
  const missing = rows.filter((row) => !row.phone || !row.phoneVerifiedAt).length;
  const unverified = rows.filter((row) => row.phone && !row.phoneVerifiedAt).length;
  const byPhone = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.phone) continue;
    const list = byPhone.get(row.phone) ?? [];
    list.push(row.id);
    byPhone.set(row.phone, list);
  }
  const duplicatePhoneCount = [...byPhone.values()].filter((ids) => ids.length > 1).length;
  return {
    total: rows.length,
    missing,
    unverified,
    duplicatePhoneCount,
    linked: rows.filter((row) => row.phone && row.phoneVerifiedAt).length,
  };
}
