import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { isProd } from '../env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `${req.method} ${req.path} — ийм зам байхгүй.` },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Олдсонгүй.' } });
      return;
    }
    if (error.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'Давхардсан утга байна.', details: error.meta },
      });
      return;
    }
    if (error.code === 'P2003') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'Холбоотой өгөгдөл байгаа тул гүйцэтгэх боломжгүй.' },
      });
      return;
    }
  }

  console.error('[error]', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Дотоод алдаа гарлаа.',
      details: isProd ? undefined : String(error instanceof Error ? error.stack : error),
    },
  });
}
