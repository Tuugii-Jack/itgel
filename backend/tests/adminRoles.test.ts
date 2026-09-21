import { describe, expect, it } from 'vitest';
import {
  canAccessLeasing,
  canAccessShopAdmin,
  canAccessStaff,
  canWriteShop,
  canManageTargetAdminPhones,
  isAdminRole,
  workspaceDestinations,
} from '../src/lib/adminRoles.js';

describe('adminRoles', () => {
  it('OWNER бүх удирдлагын хэсэгт хандана', () => {
    expect(isAdminRole('OWNER')).toBe(true);
    expect(canAccessShopAdmin('OWNER')).toBe(true);
    expect(canAccessStaff('OWNER')).toBe(true);
    expect(canAccessLeasing('OWNER')).toBe(true);
    expect(canWriteShop('OWNER')).toBe(true);
    expect(workspaceDestinations('OWNER')).toEqual(['shop', 'leasing', 'store']);
  });

  it('ADMIN/STAFF/LEASING эрхийг өргөжүүлэхгүй', () => {
    expect(canAccessLeasing('ADMIN')).toBe(false);
    expect(canAccessLeasing('STAFF')).toBe(false);
    expect(canAccessShopAdmin('LEASING')).toBe(false);
    expect(canAccessStaff('LEASING')).toBe(false);
    expect(canAccessShopAdmin('STAFF')).toBe(false);
    expect(canWriteShop('STAFF')).toBe(false);
    expect(canWriteShop('LEASING')).toBe(false);
    expect(workspaceDestinations('ADMIN')).toEqual(['shop']);
    expect(workspaceDestinations('STAFF')).toEqual(['shop']);
    expect(workspaceDestinations('LEASING')).toEqual(['leasing']);
  });

  it('OWNER-ийн нэвтрэх дугаарыг ADMIN удирдахгүй', () => {
    expect(canManageTargetAdminPhones('ADMIN', 'OWNER')).toBe(false);
    expect(canManageTargetAdminPhones('OWNER', 'OWNER')).toBe(true);
    expect(canManageTargetAdminPhones('ADMIN', 'STAFF')).toBe(true);
    expect(canManageTargetAdminPhones('STAFF', 'ADMIN')).toBe(false);
  });
});
