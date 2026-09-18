import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { unauthorized } from '../../lib/errors.js';
import { requireAdminUser } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { workspaceDestinations } from '../../lib/adminRoles.js';
import { setSessionCookies } from '../../lib/sessionCookies.js';
import { revokeWorkspaceSessions } from '../../services/workspaceAuth.js';
import { issueAdminLoginPhoneOtp, verifyAdminLoginPhone } from '../../services/adminLoginPhone.js';

export const adminAuthRouter = Router();

adminAuthRouter.post(
  '/login',
  asyncHandler(async () => {
    throw unauthorized('Нэвтрэх боломжгүй.');
  }),
);

adminAuthRouter.get(
  '/me',
  requireAdminUser,
  asyncHandler(async (req, res) => {
    const user = await prisma.adminUser.findUnique({
      where: { id: req.auth!.sub },
      include: { loginPhones: { select: { phone: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!user?.isActive) throw unauthorized();
    const loginPhones = user.loginPhones.map((row) => row.phone);
    res.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        hasLoginPhone: loginPhones.length > 0 || Boolean(user.phone && user.phoneVerifiedAt),
        loginPhones,
        destinations: workspaceDestinations(user.role),
      },
    });
  }),
);

adminAuthRouter.post(
  '/logout',
  requireAdminUser,
  asyncHandler(async (req, res) => {
    await revokeWorkspaceSessions(req.auth!.sub, `admin:${req.auth!.sub}`);
    setSessionCookies(req, res, { admin: null });
    res.json({ data: { ok: true } });
  }),
);

adminAuthRouter.post(
  '/login-phone/otp',
  requireAdminUser,
  validate({
    body: z.object({
      adminId: z.string().min(1).optional(),
      phone: z.string().min(8).max(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { adminId?: string; phone: string };
    const targetAdminId = body.adminId?.trim() || req.auth!.sub;
    const otp = await issueAdminLoginPhoneOtp({
      targetAdminId,
      phone: body.phone,
      actorAdminId: req.auth!.sub,
      actorRole: req.auth!.role,
      ip: req.ip,
    });
    res.json({ data: otp });
  }),
);

adminAuthRouter.post(
  '/login-phone/verify',
  requireAdminUser,
  validate({
    body: z.object({
      adminId: z.string().min(1).optional(),
      phone: z.string().min(8).max(20),
      code: z.string().regex(/^\d{6}$/, 'Код 6 оронтой байна.'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { adminId?: string; phone: string; code: string };
    const targetAdminId = body.adminId?.trim() || req.auth!.sub;
    const user = await verifyAdminLoginPhone({
      targetAdminId,
      phone: body.phone,
      code: body.code,
      actorAdminId: req.auth!.sub,
      actorRole: req.auth!.role,
    });
    res.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        hasLoginPhone: Boolean(user.phone) || (user.loginPhones?.length ?? 0) > 0,
        loginPhones: user.loginPhones?.map((row) => row.phone),
      },
    });
  }),
);
