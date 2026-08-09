import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { asyncHandler, validate } from '../../middleware/validate.js';
import { presignAdImage } from '../../services/storage.js';

export const adminAdsRouter = Router();

const idParams = z.object({ id: z.string().min(1) });

function serializeAd(ad: {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: ad.id,
    title: ad.title,
    imageUrl: ad.imageUrl,
    linkUrl: ad.linkUrl,
    isActive: ad.isActive,
    sortOrder: ad.sortOrder,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
  };
}

adminAdsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const ads = await prisma.ad.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ data: ads.map(serializeAd) });
  }),
);

adminAdsRouter.post(
  '/',
  validate({
    body: z.object({
      title: z.string().trim().max(120).default(''),
      imageUrl: z.string().url(),
      linkUrl: z.string().trim().url().nullable().optional(),
      isActive: z.boolean().default(true),
      sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    const ad = await prisma.ad.create({ data: req.body });
    await audit({
      actor: actorOf(req),
      action: 'CREATE',
      entity: 'Ad',
      entityId: ad.id,
      after: ad,
    });
    res.status(201).json({ data: serializeAd(ad) });
  }),
);

adminAdsRouter.patch(
  '/:id',
  validate({
    params: idParams,
    body: z.object({
      title: z.string().trim().max(120).optional(),
      imageUrl: z.string().url().optional(),
      linkUrl: z.string().trim().url().nullable().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const before = await prisma.ad.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!before) throw notFound('Зар олдсонгүй.');

    const after = await prisma.ad.update({ where: { id: before.id }, data: req.body });
    await audit({
      actor: actorOf(req),
      action: 'UPDATE',
      entity: 'Ad',
      entityId: after.id,
      before,
      after,
    });
    res.json({ data: serializeAd(after) });
  }),
);

adminAdsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const ad = await prisma.ad.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!ad) throw notFound('Зар олдсонгүй.');

    const deleted = await prisma.ad.update({
      where: { id: ad.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await audit({
      actor: actorOf(req),
      action: 'DELETE',
      entity: 'Ad',
      entityId: deleted.id,
      before: ad,
    });

    res.json({ data: { id: deleted.id, deletedAt: deleted.deletedAt?.toISOString() ?? null } });
  }),
);

/** POST /:id/image — presigned upload URL. */
adminAdsRouter.post(
  '/:id/image',
  validate({
    params: idParams,
    body: z.object({
      contentType: z.string().min(3).max(100),
    }),
  }),
  asyncHandler(async (req, res) => {
    const ad = await prisma.ad.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!ad) throw notFound('Зар олдсонгүй.');

    const presigned = await presignAdImage(ad.id, req.body.contentType);
    res.json({ data: presigned });
  }),
);
