import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';

export const adminCategoriesRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

adminCategoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    });

    res.json({
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        productCount: c._count.products,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  }),
);

adminCategoriesRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(60),
      isActive: z.boolean().default(true),
      sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.create({ data: req.body });
    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'Category',
      entityId: category.id,
      after: category,
    });
    res.status(201).json({ data: category });
  }),
);

adminCategoriesRouter.patch(
  '/:id',
  validate({
    params: idParams,
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const before = await prisma.category.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!before) throw notFound('Ангилал олдсонгүй.');

    const after = await prisma.category.update({ where: { id: before.id }, data: req.body });
    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Category',
      entityId: after.id,
      before,
      after,
    });
    res.json({ data: after });
  }),
);

/** Бараатай ангилал устгагдахгүй — 409. */
adminCategoriesRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    });
    if (!category) throw notFound('Ангилал олдсонгүй.');

    if (category._count.products > 0) {
      throw conflict(
        `Энэ ангилалд ${category._count.products} бараа байна. Эхлээд барааг өөр ангилалд шилжүүлнэ үү.`,
        { productCount: category._count.products },
      );
    }

    const deleted = await prisma.category.update({
      where: { id: category.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await audit({
      actor: actorOf(req),
      action: 'DELETE',
      entity: 'Category',
      entityId: deleted.id,
      before: category,
    });

    res.json({ data: { id: deleted.id, deletedAt: deleted.deletedAt } });
  }),
);
