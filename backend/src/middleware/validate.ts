import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../lib/errors.js';

/** Бүх endpoint дээр zod-оор шалгана. */
export function validate<TBody extends ZodTypeAny, TQuery extends ZodTypeAny, TParams extends ZodTypeAny>(schemas: {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        // Express 5-д req.query нь getter — шинэ утгыг тусад нь хадгална.
        Object.defineProperty(req, 'validatedQuery', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          badRequest(
            'Оруулсан утга буруу байна.',
            error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          ),
        );
        return;
      }
      next(error);
    }
  };
}

export function query<T>(req: Request): T {
  return ((req as unknown as { validatedQuery?: T }).validatedQuery ?? req.query) as T;
}

/** Zod-оор шалгагдсан зам дахь параметр — заавал байна. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) throw badRequest(`Параметр дутуу: ${name}`);
  return value;
}

/** async handler-ийн алдааг Express рүү дамжуулна. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export type Infer<T extends ZodTypeAny> = z.infer<T>;
