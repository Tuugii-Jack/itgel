import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { isAdminRole, type AdminRoleName } from './adminRoles.js';

export { isAdminRole };
export type { AdminRoleName };

export interface CustomerToken {
  sub: string;
  email: string | null;
  phone: string | null;
  role: 'CUSTOMER';
}

export interface AdminToken {
  sub: string;
  email: string;
  role: AdminRoleName;
  tv: number;
}

export type TokenPayload = CustomerToken | AdminToken;

export function signCustomerToken(payload: Omit<CustomerToken, 'role'>): string {
  return jwt.sign({ ...payload, role: 'CUSTOMER' } satisfies CustomerToken, env.JWT_SECRET, {
    expiresIn: env.JWT_CUSTOMER_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function signAdminToken(
  payload: Omit<AdminToken, 'role'> & { role: AdminToken['role']; tv: number },
): string {
  return jwt.sign(payload satisfies AdminToken, env.JWT_SECRET, {
    expiresIn: env.JWT_ADMIN_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

