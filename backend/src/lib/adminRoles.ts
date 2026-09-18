export const ADMIN_ROLES = ['ADMIN', 'STAFF', 'LEASING', 'OWNER'] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];
export type WorkspaceDestination = 'shop' | 'leasing' | 'store';

export function isAdminRole(role: string | undefined): role is AdminRoleName {
  return role === 'ADMIN' || role === 'STAFF' || role === 'LEASING' || role === 'OWNER';
}

export function isOwnerRole(role: string | undefined): boolean {
  return role === 'OWNER';
}

export function canAccessShopAdmin(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER';
}

export function canAccessStaff(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'STAFF' || role === 'OWNER';
}

export function canAccessLeasing(role: string | undefined): boolean {
  return role === 'LEASING' || role === 'OWNER';
}

export function canWriteShop(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER';
}

export function canManageOtherAdminPhones(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER';
}

export function canViewAllSettlements(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'OWNER';
}

export function workspaceDestinations(role: string | undefined): WorkspaceDestination[] {
  if (role === 'OWNER') return ['shop', 'leasing', 'store'];
  if (role === 'LEASING') return ['leasing'];
  if (role === 'ADMIN' || role === 'STAFF') return ['shop'];
  return [];
}
