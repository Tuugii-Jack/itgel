import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken, type AdminToken, type TokenPayload } from '../lib/jwt.js';
import { prisma } from '../prisma.js';
import { resolveSupabaseToken, supabaseAuthConfigured } from '../lib/supabaseAuth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * JWT доторх эрх хуучирсан байж болно — идэвх, role-ийг DB-ээс авна.
 * Хаасан/бууруулсан админы хуучин токен шууд хүчингүй.
 */
async function liveAdmin(payload: AdminToken): Promise<AdminToken | null> {
  const user = await prisma.adminUser.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!user?.isActive) return null;
  return { sub: user.id, email: user.email, role: user.role };
}

/** Эхлээд манай JWT, дараа нь Supabase Auth-ийн token-ыг шалгана. */
async function authenticate(req: Request): Promise<TokenPayload | null> {
  const token = readToken(req);
  if (!token) return null;

  const own = verifyToken(token);
  if (own) {
    if (own.role === 'ADMIN' || own.role === 'STAFF') return liveAdmin(own);
    return own;
  }

  const supabase = supabaseAuthConfigured ? await resolveSupabaseToken(token) : null;
  if (supabase && (supabase.role === 'ADMIN' || supabase.role === 'STAFF')) {
    return liveAdmin(supabase);
  }
  return supabase;
}

/** Токен байвал уншина, байхгүй бол ч алдаа заахгүй. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  authenticate(req)
    .then((payload) => {
      if (payload) req.auth = payload;
      next();
    })
    .catch(next);
}

function guard(check: (payload: TokenPayload) => Error | null) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    authenticate(req)
      .then((payload) => {
        if (!payload) {
          next(unauthorized());
          return;
        }
        const error = check(payload);
        if (error) {
          next(error);
          return;
        }
        req.auth = payload;
        next();
      })
      .catch(next);
  };
}

/** Хэрэглэгч заавал нэвтэрсэн байх. */
export const requireCustomer = guard((payload) =>
  payload.role === 'CUSTOMER' ? null : unauthorized(),
);

/** Админ эрх шаардана. */
export const requireAdmin = guard((payload) =>
  payload.role === 'ADMIN' ? null : forbidden('Зөвхөн админ хандах боломжтой.'),
);

/** Админ эсвэл ажилтан. */
export const requireStaff = guard((payload) =>
  payload.role === 'ADMIN' || payload.role === 'STAFF' ? null : forbidden('Хандах эрхгүй.'),
);

/** GET-ийг туслах админд зөвшөөрнө. Бичих үйлдэл зөвхөн админ. */
export function requireAdminWrites(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.auth?.role === 'ADMIN') {
    next();
    return;
  }
  next(forbidden('Туслах админ зөвхөн харах болон хүлээлгэн өгөх эрхтэй.'));
}

export function actorOf(req: Request): string {
  if (!req.auth) return 'anonymous';
  return req.auth.role === 'CUSTOMER' ? `customer:${req.auth.sub}` : `admin:${req.auth.sub}`;
}
