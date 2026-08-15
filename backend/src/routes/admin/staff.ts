import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';

export const adminStaffRouter = Router();

const BCRYPT_ROUNDS = 10;

const emailSchema = z
  .string()
  .trim()
  .email('И-мэйл буруу байна.')
  .max(120)
  .transform((v) => v.toLowerCase());

function publicAdmin(user: {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/** GET /admin/staff — админ болон туслах админгийн жагсаалт. */
adminStaffRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.adminUser.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ data: users.map(publicAdmin) });
  }),
);

/** POST /admin/staff — туслах админ үүсгэнэ. */
adminStaffRouter.post(
  '/',
  validate({
    body: z.object({
      email: emailSchema,
      name: z.string().trim().min(1).max(80),
      password: z.string().min(6).max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, name, password } = req.body as {
      email: string;
      name: string;
      password: string;
    };

    const taken = await prisma.adminUser.findUnique({ where: { email } });
    if (taken) throw conflict('Энэ и-мэйлээр админ бүртгэл байна.');

    const user = await prisma.adminUser.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        role: 'STAFF',
      },
    });

    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'AdminUser',
      entityId: user.id,
      after: { email: user.email, name: user.name, role: user.role },
    });

    res.status(201).json({ data: publicAdmin(user) });
  }),
);

/** PATCH /admin/staff/:id — нэр, идэвх, нууц үг. */
adminStaffRouter.patch(
  '/:id',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(80).optional(),
      password: z.string().min(6).max(100).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const body = req.body as { name?: string; password?: string; isActive?: boolean };

    const user = await prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw notFound('Админ олдсонгүй.');

    if (body.isActive === false) {
      if (user.id === req.auth!.sub) {
        throw badRequest('Өөрийн бүртгэлийг идэвхгүй болгож болохгүй.');
      }
      if (user.role === 'ADMIN') {
        const otherAdmins = await prisma.adminUser.count({
          where: { role: 'ADMIN', isActive: true, id: { not: user.id } },
        });
        if (otherAdmins === 0) {
          throw badRequest('Сүүлийн админыг идэвхгүй болгож болохгүй.');
        }
      }
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.password
          ? { passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS) }
          : {}),
      },
    });

    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'AdminUser',
      entityId: updated.id,
      before: { name: user.name, isActive: user.isActive },
      after: { name: updated.name, isActive: updated.isActive, passwordChanged: Boolean(body.password) },
    });

    res.json({ data: publicAdmin(updated) });
  }),
);
