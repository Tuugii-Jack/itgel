import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from './errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Санах ойд суурилсан энгийн rate limiter.
 * Олон instance ажиллуулах үед Redis рүү шилжүүлнэ — интерфейс нь адил.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Хязгаарт хүрээгүй бол true. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: 0, remaining: this.limit - 1 };
    }
    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
        remaining: 0,
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSec: 0, remaining: this.limit - bucket.count };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Хугацаа нь дууссан bucket-уудыг цэвэрлэнэ (cron дуудна). */
  sweep(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/** IP-ээр хязгаарлах middleware үүсгэгч. */
export function ipRateLimit(limit: number, windowMs: number) {
  const limiter = new RateLimiter(limit, windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const result = limiter.hit(key);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      next(
        tooManyRequests(
          `Хэт олон хүсэлт илгээлээ. ${result.retryAfterSec} секундын дараа дахин оролдоно уу.`,
        ),
      );
      return;
    }
    next();
  };
}
