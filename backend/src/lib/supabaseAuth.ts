import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import type { AdminToken, CustomerToken, TokenPayload } from './jwt.js';

/**
 * Supabase Auth-ийн олгосон access token-ыг JWKS-ээр шалгана.
 * И-мэйлээр Customer холбоно (утасны OTP байхгүй).
 */
const jwks = env.SUPABASE_JWKS_URL ? createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL)) : null;

export const supabaseAuthConfigured = jwks !== null;

interface SupabaseClaims {
  sub: string;
  phone?: string;
  email?: string;
  user_metadata?: { phone?: string; name?: string; email?: string };
  app_metadata?: { role?: string };
}

async function verify(token: string): Promise<SupabaseClaims | null> {
  if (!jwks) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined,
      audience: 'authenticated',
    });
    return payload as unknown as SupabaseClaims;
  } catch {
    return null;
  }
}

export async function resolveSupabaseToken(token: string): Promise<TokenPayload | null> {
  const claims = await verify(token);
  if (!claims) return null;

  const role = claims.app_metadata?.role?.toUpperCase();
  if ((role === 'ADMIN' || role === 'STAFF') && claims.email) {
    const admin = await prisma.adminUser.findFirst({
      where: { email: claims.email.toLowerCase(), isActive: true },
    });
    if (!admin) return null;
    return { sub: admin.id, email: admin.email, role: admin.role } satisfies AdminToken;
  }

  const email = (claims.email ?? claims.user_metadata?.email)?.toLowerCase();
  if (!email) return null;

  const customer = await prisma.customer.upsert({
    where: { email },
    create: {
      email,
      name: claims.user_metadata?.name ?? null,
      emailVerifiedAt: new Date(),
    },
    update: {},
  });

  return {
    sub: customer.id,
    email: customer.email,
    phone: customer.phone,
    role: 'CUSTOMER',
  } satisfies CustomerToken;
}
