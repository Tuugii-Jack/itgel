import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import {
  canAccessLeasing,
  canAccessShopAdmin,
  canAccessStaff,
  canWriteShop,
  isAdminRole,
} from '../lib/adminRoles.js';
import { verifyToken, type AdminToken, type TokenPayload } from '../lib/jwt.js';
import { prisma } from '../prisma.js';
import { resolveSupabaseToken, supabaseAuthConfigured } from '../lib/supabaseAuth.js';
import {
  ADMIN_SESSION_COOKIE,
  cookieMutationAllowed,
  CUSTOMER_SESSION_COOKIE,
  parseCookies,
} from '../lib/sessionCookies.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function cookieToken(req: Request, kind: 'admin' | 'customer'): string | null {
  const cookies = parseCookies(
    typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
  );
  const raw = kind === 'admin' ? cookies[ADMIN_SESSION_COOKIE] : cookies[CUSTOMER_SESSION_COOKIE];
  return raw?.trim() || null;
}

/**
 * JWT доторх эрх хуучирсан байж болно — идэвх, role, tokenVersion-ийг DB-ээс авна.
 */
async function liveAdmin(payload: AdminToken): Promise<AdminToken | null> {
  const user = await prisma.adminUser.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      tokenVersion: true,
      phoneVerifiedAt: true,
      loginPhones: { select: { id: true }, take: 1 },
    },
  });
  if (!user?.isActive) return null;
  if (user.loginPhones.length === 0 && !user.phoneVerifiedAt) return null;
  if (payload.tv !== user.tokenVersion) return null;
  return { sub: user.id, email: user.email, role: user.role, tv: user.tokenVersion };
}

type AuthKind = 'customer' | 'admin';

async function payloadFromToken(token: string): Promise<TokenPayload | null> {
  const own = verifyToken(token);
  if (own) {
    if (own.role === 'CUSTOMER') return own;
    if (isAdminRole(own.role)) {
      return liveAdmin({
        sub: own.sub,
        email: own.email,
        role: own.role,
        tv: 'tv' in own && typeof own.tv === 'number' ? own.tv : -1,
      });
    }
    return null;
  }
  if (!supabaseAuthConfigured) return null;
  const supabase = await resolveSupabaseToken(token);
  if (!supabase) return null;
  if (supabase.role === 'CUSTOMER') return supabase;
  return null;
}

async function authenticate(req: Request, kind?: AuthKind): Promise<TokenPayload | null> {
  const bearer = readBearer(req);
  const fromCookie = kind ? cookieToken(req, kind) : null;
  const tokens = [bearer, fromCookie].filter((value, index, all): value is string => {
    return Boolean(value) && all.indexOf(value) === index;
  });

  for (const token of tokens) {
    const payload = await payloadFromToken(token);
    if (!payload) continue;
    if (kind === 'admin' && !isAdminRole(payload.role)) continue;
    if (kind === 'customer' && payload.role !== 'CUSTOMER') continue;
    const usedCookie = !bearer && token === fromCookie;
    if (!cookieMutationAllowed(req, usedCookie)) continue;
    return payload;
  }
  return null;
}

export function resolveAuth(req: Request, kind?: AuthKind): Promise<TokenPayload | null> {
  return authenticate(req, kind);
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

function guard(check: (payload: TokenPayload) => Error | null, kind?: AuthKind) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    authenticate(req, kind)
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
export const requireCustomer = guard(
  (payload) => (payload.role === 'CUSTOMER' ? null : unauthorized()),
  'customer',
);

/** Админ эрх шаардана. */
export const requireAdmin = guard(
  (payload) =>
    canAccessShopAdmin(payload.role) ? null : forbidden('Зөвхөн админ хандах боломжтой.'),
  'admin',
);

/** Админ эсвэл ажилтан. */
export const requireStaff = guard(
  (payload) => (canAccessStaff(payload.role) ? null : forbidden('Хандах эрхгүй.')),
  'admin',
);

/** Админ, туслах, лизинг, эсвэл эзэмшигч — нэвтрэлт / нууц үг. */
export const requireAdminUser = guard(
  (payload) => (isAdminRole(payload.role) ? null : forbidden('Хандах эрхгүй.')),
  'admin',
);

/** Лизингийн админ эсвэл эзэмшигч. */
export const requireLeasing = guard(
  (payload) =>
    canAccessLeasing(payload.role) ? null : forbidden('Зөвхөн лизингийн админ хандах боломжтой.'),
  'admin',
);

/** GET-ийг туслах админд зөвшөөрнө. Бичих үйлдэл зөвхөн админ/эзэмшигч. */
export function requireAdminWrites(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (canWriteShop(req.auth?.role)) {
    next();
    return;
  }
  next(forbidden('Туслах админ зөвхөн харах болон хүлээлгэн өгөх эрхтэй.'));
}

export function actorOf(req: Request): string {
  if (!req.auth) return 'anonymous';
  return req.auth.role === 'CUSTOMER' ? `customer:${req.auth.sub}` : `admin:${req.auth.sub}`;
}
