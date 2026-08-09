import { randomInt } from 'node:crypto';

/** Андуурч уншихаас сэргийлж I, O, 0, 1 -ийг хассан. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Захиалгын код: `PH-` + 6 тэмдэгт. */
export function generateOrderCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `PH-${out}`;
}

/** OTP — 4 орон. */
export function generateOtp(): string {
  return String(randomInt(1000, 10000));
}

/** Утасны дугаарыг нэг хэлбэрт (8 орон, зөвхөн тоо). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.startsWith('976') && digits.length === 11 ? digits.slice(3) : digits;
}

export const PHONE_RE = /^[5-9]\d{7}$/;
