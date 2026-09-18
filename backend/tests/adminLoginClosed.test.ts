import type { Request, Response, Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/prisma.js', () => ({
  prisma: { adminUser: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('../src/services/workspaceAuth.js', () => ({
  revokeWorkspaceSessions: vi.fn(),
}));
vi.mock('../src/lib/sessionCookies.js', () => ({
  setSessionCookies: vi.fn(),
}));
vi.mock('../src/services/adminLoginPhone.js', () => ({
  issueAdminLoginPhoneOtp: vi.fn(),
  verifyAdminLoginPhone: vi.fn(),
}));
vi.mock('../src/middleware/auth.js', () => ({
  requireAdminUser: (_req: Request, _res: Response, next: () => void) => next(),
}));

import { adminAuthRouter } from '../src/routes/admin/auth.js';

function invoke(router: Router, method: string, path: string, body: Record<string, unknown> = {}) {
  const route = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  if (!route) throw new Error(`route ${method} ${path} missing`);
  return new Promise((resolve, reject) => {
    const req = { body, ip: '127.0.0.1' } as unknown as Request;
    const res = {
      status(code: number) {
        Object.assign(this, { statusCode: code });
        return this;
      },
      json: resolve,
    } as unknown as Response;
    let index = 0;
    const next = (error?: unknown) => {
      if (error) return reject(error);
      const handler = route.stack[index++]?.handle;
      if (!handler) return reject(new Error('no handler'));
      handler(req, res, next);
    };
    next();
  });
}

describe('хуучин админ нэвтрэлт', () => {
  it('password login session олгохгүй', async () => {
    await expect(
      invoke(adminAuthRouter, 'post', '/login', {
        email: 'admin@itgel.mn',
        password: 'admin123',
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
