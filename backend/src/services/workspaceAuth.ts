import { prisma } from '../prisma.js';
import { audit } from '../lib/audit.js';
import { signAdminToken } from '../lib/jwt.js';
import {
  workspaceDestinations,
  type AdminRoleName,
  type WorkspaceDestination,
} from '../lib/adminRoles.js';
import { normalizeLoginPhone } from './phoneOtp.js';

const ADMIN_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  tokenVersion: true,
} as const;

export type WorkspaceUser = {
  id: string;
  email: string;
  name: string;
  role: AdminRoleName;
  destinations: WorkspaceDestination[];
};

export type WorkspaceSession = {
  token: string;
  user: WorkspaceUser;
};

type ActiveAdmin = {
  id: string;
  email: string;
  name: string;
  role: AdminRoleName;
  isActive: boolean;
  tokenVersion: number;
};

async function findActiveAdminByLoginPhone(phone: string): Promise<ActiveAdmin | null> {
  const login = await prisma.adminLoginPhone.findUnique({
    where: { phone },
    include: { admin: { select: ADMIN_SELECT } },
  });
  if (login) return login.admin.isActive ? login.admin : null;

  return prisma.adminUser.findFirst({
    where: {
      phone,
      phoneVerifiedAt: { not: null },
      isActive: true,
    },
    select: ADMIN_SELECT,
  });
}

export async function peekWorkspace(phoneRaw: string | null | undefined): Promise<WorkspaceUser | null> {
  const trimmed = String(phoneRaw || '').trim();
  if (!trimmed) return null;
  let phone: string;
  try {
    phone = normalizeLoginPhone(trimmed);
  } catch {
    return null;
  }
  const admin = await findActiveAdminByLoginPhone(phone);
  if (!admin) return null;
  return publicWorkspaceUser(admin);
}

function publicWorkspaceUser(user: {
  id: string;
  email: string;
  name: string;
  role: AdminRoleName;
}): WorkspaceUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    destinations: workspaceDestinations(user.role),
  };
}

/**
 * OTP баталгаажсаны ДАРАА л дуудна.
 * Идэвхгүй/утас баталгаажаагүй админд session өгөхгүй.
 * Клиентийн role/adminId-г уншихгүй.
 * tokenVersion-ийг нэмэхгүй — өөр дугаараар нэвтрэхэд бусад session хүчинтэй үлдэнэ.
 */
export async function openWorkspaceSession(
  phoneRaw: string,
  actor?: string,
): Promise<WorkspaceSession | null> {
  const phone = normalizeLoginPhone(phoneRaw);
  const admin = await findActiveAdminByLoginPhone(phone);
  if (!admin) return null;

  const updated = await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
    select: ADMIN_SELECT,
  });

  await audit({
    actor: actor ?? `admin:${updated.id}`,
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
