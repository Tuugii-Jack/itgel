export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; code?: unknown; message?: unknown };
  return (
    typeof e.status === 'number' &&
    typeof e.code === 'string' &&
    typeof e.message === 'string' &&
    e.status >= 400 &&
    e.status < 600 &&
    !e.code.startsWith('P')
  );
}

/** Prisma $transaction алдааг боож AppError-ийг нууж болно. */
export function unwrapAppError(error: unknown): AppError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (isAppError(current)) return current;
    current = 'cause' in current ? (current as { cause: unknown }).cause : null;
  }
  return null;
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Нэвтрэх шаардлагатай.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Хандах эрхгүй.') => new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Олдсонгүй.') => new AppError(404, 'NOT_FOUND', message);

/** Бизнес дүрэм зөрчсөн — буруу төлөв шилжилт, бараатай ангилал устгах гэх мэт. */
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

export const tooManyRequests = (message: string, details?: unknown) =>
  new AppError(429, 'TOO_MANY_REQUESTS', message, details);
