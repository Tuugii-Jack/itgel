export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
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
