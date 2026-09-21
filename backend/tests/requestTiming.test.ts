import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { addAuthDuration, addDbQuery, requestTimingMiddleware } from '../src/lib/requestTiming.js';

function mockReq(path = '/api/leasing/orders/summary'): Request {
  return { method: 'GET', path } as Request;
}

function mockRes() {
  const headers = new Map<string, string>();
  const res = {
    headersSent: false,
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    writeHead(_status: number, maybeHeaders?: Record<string, string>) {
      if (maybeHeaders && typeof maybeHeaders === 'object' && !Array.isArray(maybeHeaders)) {
        for (const [key, value] of Object.entries(maybeHeaders)) headers.set(key.toLowerCase(), String(value));
      }
      this.headersSent = true;
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    },
  };
  return res as unknown as Response & { headers: Map<string, string> };
}

describe('request timing', () => {
  it('Server-Timing-д auth болон db-г SQL-гүйгээр гаргана', () => {
    const req = mockReq();
    const res = mockRes();
    requestTimingMiddleware(req, res, () => {
      addAuthDuration(40);
      addDbQuery(900);
      addDbQuery(1200);
      res.end();
    });
    const timing = res.headers.get('server-timing') ?? '';
    expect(timing).toContain('auth;dur=40');
    expect(timing).toContain('db;dur=2100;desc="n=2,max=1200"');
    expect(timing).toContain('dbmax;dur=1200');
    expect(timing).not.toContain('SELECT');
  });

  it('writeHead headers объект дээр Server-Timing үлдэнэ', () => {
    const req = mockReq('/health');
    const res = mockRes();
    requestTimingMiddleware(req, res, () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end();
    });
    expect(res.headers.get('server-timing')).toMatch(/app;dur=\d+/);
    expect(res.headers.get('content-type')).toBe('application/json');
  });
});
