import type { CorsOptions } from 'cors';

/** Браузер preflight-ийг энэ хугацаанд дахин илгээхгүй. */
export const CORS_PREFLIGHT_MAX_AGE_SEC = 600;

/**
 * JSON API-г дэлгүүрийн origin-оос fetch хийнэ.
 * Helmet-ийн default CORP `same-origin` нь split frontend/API-г блоклоно.
 */
export const API_HELMET_OPTIONS = {
  crossOriginResourcePolicy: { policy: 'cross-origin' as const },
};

/**
 * Хувийн API-г shared cache-д бүү хий.
 * OPTIONS дээр no-store тавибал Chrome Access-Control-Max-Age-ийг үл тооно.
 */
export function setPrivateApiCache(
  req: { path: string; method: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void,
): void {
  if (req.path.startsWith('/api') && req.method !== 'OPTIONS') {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}

export function corsMiddlewareOptions(origin: CorsOptions['origin']): CorsOptions {
  return {
    origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Idempotency-Key',
      'X-Forwarded-For',
      // fetch cache: "no-store" нэмдэг — жинхэнэ браузерын preflight эндээс унадаг.
      'Cache-Control',
      'Pragma',
    ],
    maxAge: CORS_PREFLIGHT_MAX_AGE_SEC,
    optionsSuccessStatus: 204,
  };
}
