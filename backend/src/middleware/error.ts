import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { unwrapAppError } from '../lib/errors.js';
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
  const appError = unwrapAppError(error);
  if (appError) {
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
    });
    return;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: number }).status === 413
  ) {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Зураг хэт том байна (дээд тал нь 5MB).' },
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
    if (error.code === 'P2028' || error.code === 'P2024') {
      res.status(503).json({
        error: {
          code: 'TIMEOUT',
          message: 'Хадгалалт хугацаа хэтэрлээ. Дахин оролдоно уу.',
        },
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
