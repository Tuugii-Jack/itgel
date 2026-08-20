import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { unauthorized } from '../../lib/errors.js';
import { signAdminToken } from '../../lib/jwt.js';
import { ipRateLimit } from '../../lib/rateLimit.js';
import { requireStaff } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';

export const adminAuthRouter = Router();

/**
 * Промпт дээр админ нэвтрэх endpoint тусад нь заагаагүй ч
 * JWT авах гарц хэрэгтэй тул email/нууц үгээр нэвтрэх хэсгийг нэмсэн.
 */
adminAuthRouter.post(
  '/login',
  ipRateLimit(10, 10 * 60 * 1000),
  validate({
    body: z.object({ email: z.string().email(), password: z.string().min(6).max(100) }),
  }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user?.isActive ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) throw unauthorized('И-мэйл эсвэл нууц үг буруу байна.');

    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    res.json({
      data: {
        token: signAdminToken({ sub: user.id, email: user.email, role: user.role }),
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
    });
  }),
);

adminAuthRouter.get(
  '/me',
  requireStaff,
  asyncHandler(async (req, res) => {
    const user = await prisma.adminUser.findUnique({ where: { id: req.auth!.sub } });
    if (!user?.isActive) throw unauthorized();
    res.json({ data: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }),
);

/** POST /admin/auth/password — админ өөрийн нууц үг солих. */
adminAuthRouter.post(
  '/password',
  requireStaff,
  validate({
    body: z.object({
      currentPassword: z.string().min(6).max(100),
      newPassword: z.string().min(6).max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    const user = await prisma.adminUser.findUnique({ where: { id: req.auth!.sub } });
    if (!user?.isActive) throw unauthorized();

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw unauthorized('Одоогийн нууц үг буруу байна.');

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    res.json({ data: { ok: true } });
  }),
);
