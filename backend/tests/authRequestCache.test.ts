import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../src/prisma.js', () => ({ prisma: { adminUser: { findUnique } } }));
import { resolveAuth } from '../src/middleware/auth.js';
import { signAdminToken, signCustomerToken } from '../src/lib/jwt.js';

const token = signAdminToken({ sub: 'admin-1', email: 'test@itgel.test', role: 'ADMIN', tv: 1 });
const user = { id: 'admin-1', email: 'test@itgel.test', role: 'ADMIN', isActive: true, tokenVersion: 1, phoneVerifiedAt: new Date(), loginPhones: [] };
const request = () => ({ method: 'GET', headers: { authorization: `Bearer ${token}` } }) as Request;

describe('request-scoped credential validation', () => {
  beforeEach(() => { findUnique.mockReset(); findUnique.mockResolvedValue(user); });
  it('concurrent and sequential guards share only this request\'s validation', async () => {
    const req = request();
    const [a, b] = await Promise.all([resolveAuth(req, 'admin'), resolveAuth(req, 'admin')]);
    expect(a).toEqual(b);
    await resolveAuth(req, 'admin');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
  it('the next request immediately observes revocation and role changes', async () => {
    expect(await resolveAuth(request(), 'admin')).toMatchObject({ role: 'ADMIN' });
    findUnique.mockResolvedValueOnce({ ...user, role: 'STAFF' });
    expect(await resolveAuth(request(), 'admin')).toMatchObject({ role: 'STAFF' });
    findUnique.mockResolvedValueOnce({ ...user, tokenVersion: 2 });
    expect(await resolveAuth(request(), 'admin')).toBeNull();
    findUnique.mockResolvedValueOnce({ ...user, isActive: false });
    expect(await resolveAuth(request(), 'admin')).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(4);
  });
  it('does not trust prefilled auth or mix customer and admin credentials', async () => {
    const req = request();
    req.auth = { sub: 'forged', email: 'forged@itgel.test', role: 'OWNER', tv: 0 };
    expect(await resolveAuth(req, 'admin')).toMatchObject({ sub: 'admin-1', role: 'ADMIN' });
    req.headers.authorization = `Bearer ${signCustomerToken({ sub: 'customer-1', email: null, phone: null })}`;
    expect(await resolveAuth(req, 'admin')).toBeNull();
    expect(await resolveAuth(req, 'customer')).toMatchObject({ sub: 'customer-1', role: 'CUSTOMER' });
  });
});
