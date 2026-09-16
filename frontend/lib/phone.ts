/** Монгол 8 оронтой дугаар — зай, зураас, +976-г хасна. */
export function parseMnPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("976") && digits.length >= 11) {
    return digits.slice(3, 11);
  }
  return digits.slice(0, 8);
}

export function formatMnPhone(digits: string): string {
  const d = parseMnPhone(digits);
  if (d.length <= 4) return d;
  return `${d.slice(0, 4)} ${d.slice(4)}`;
}

export const MN_PHONE_RE = /^[5-9]\d{7}$/;
