import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken, type TokenPayload } from '../lib/jwt.js';
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

/** Эхлээд манай JWT, дараа нь Supabase Auth-ийн token-ыг шалгана. */
async function authenticate(req: Request): Promise<TokenPayload | null> {
  const token = readToken(req);
  if (!token) return null;

  const own = verifyToken(token);
  if (own) return own;

  return supabaseAuthConfigured ? resolveSupabaseToken(token) : null;
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

export function actorOf(req: Request): string {
  if (!req.auth) return 'anonymous';
  return req.auth.role === 'CUSTOMER' ? `customer:${req.auth.sub}` : `admin:${req.auth.sub}`;
}
