import type { Request, Response } from 'express';
import { env, isProd } from '../env.js';

export const CUSTOMER_SESSION_COOKIE = 'itgel_c';
export const ADMIN_SESSION_COOKIE = 'itgel_a';

const CUSTOMER_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const ADMIN_MAX_AGE_SEC = 12 * 60 * 60;

function cookieSecure(req: Request): boolean {
  if (req.secure) return true;
  if (req.headers['x-forwarded-proto'] === 'https') return true;
  const host = (req.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

function cookieHeader(name: string, value: string, req: Request, maxAge: number): string {
  const secure = cookieSecure(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAge}`,
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearHeader(name: string, req: Request): string {
  const secure = cookieSecure(req);
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function setSessionCookies(
  req: Request,
  res: Response,
  tokens: { customer?: string | null; admin?: string | null },
): void {
  if (tokens.customer) {
    res.append('Set-Cookie', cookieHeader(CUSTOMER_SESSION_COOKIE, tokens.customer, req, CUSTOMER_MAX_AGE_SEC));
  } else if (tokens.customer === null) {
    res.append('Set-Cookie', clearHeader(CUSTOMER_SESSION_COOKIE, req));
  }
  if (tokens.admin) {
    res.append('Set-Cookie', cookieHeader(ADMIN_SESSION_COOKIE, tokens.admin, req, ADMIN_MAX_AGE_SEC));
  } else if (tokens.admin === null) {
    res.append('Set-Cookie', clearHeader(ADMIN_SESSION_COOKIE, req));
  }
}

export function allowedWebOrigins(): string[] {
  const allowed = new Set<string>();
  if (env.CORS_ORIGIN && env.CORS_ORIGIN !== '*') {
    for (const origin of env.CORS_ORIGIN.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) allowed.add(trimmed);
    }
  }
  if (!isProd) {
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of [3000, 3001, 3002, 3003, 3004, 4000, 4001]) {
        allowed.add(`http://${host}:${port}`);
      }
    }
  }
  return [...allowed];
}

/** Cookie-оор бичих хүсэлт — Bearer байхгүй үед Origin-ийг шалгана. */
export function cookieMutationAllowed(req: Request, usedCookie: boolean): boolean {
  if (!usedCookie) return true;
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!origin) return false;
  if (allowedWebOrigins().includes(origin)) return true;
  return !isProd && env.CORS_ORIGIN === '*';
}
