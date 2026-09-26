const PREFIX = 'itgel:pickup:';
const CODE_RE = /PH-[A-Z0-9]{6}/;

/** Олголтын QR — нэр, утас, JWT, төлбөр агуулахгүй. Зөвхөн захиалга олох лавлагаа. */
export function pickupQrValue(code: string): string {
  return `${PREFIX}${code.trim().toUpperCase()}`;
}

export function parsePickupLookup(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const fromPrefix = text.toUpperCase().startsWith(PREFIX.toUpperCase())
    ? text.slice(PREFIX.length).trim()
    : text;
  const match = fromPrefix.toUpperCase().match(CODE_RE);
  return match ? match[0] : null;
}
