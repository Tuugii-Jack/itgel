import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_HELMET_OPTIONS,
  CORS_PREFLIGHT_MAX_AGE_SEC,
  corsMiddlewareOptions,
  setPrivateApiCache,
} from '../src/lib/cors.js';

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

function createTestApp() {
  const app = express();
  app.use(helmet(API_HELMET_OPTIONS));
  app.use(setPrivateApiCache);
  app.use(cors(corsMiddlewareOptions(['http://localhost:3000'])));
  app.get('/api/orders/TEST', (_req, res) => {
    res.json({ data: { code: 'TEST' } });
  });
  app.get('/api/store', (_req, res) => {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ data: { name: 'store' } });
  });
  return app;
}

const origin = 'http://localhost:3000';
let server: { url: string; close: () => Promise<void> };

describe('CORS preflight and private cache', () => {
  beforeAll(async () => {
    server = await listen(createTestApp());
  });

  afterAll(async () => {
    await server?.close();
  });

  it('answers OPTIONS with max-age, methods, origin, and headers', async () => {
    const res = await fetch(`${server.url}/api/orders/TEST`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type,cache-control,pragma',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-max-age')).toBe(String(CORS_PREFLIGHT_MAX_AGE_SEC));
    expect(CORS_PREFLIGHT_MAX_AGE_SEC).toBe(600);
    const methods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('PATCH');
    expect(methods).toContain('DELETE');
    const headers = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(headers).toContain('authorization');
    expect(headers).toContain('content-type');
    expect(headers).toContain('cache-control');
    expect(headers).toContain('pragma');
    expect(res.headers.get('cache-control') ?? '').not.toMatch(/no-store/i);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('rejects a disallowed origin', async () => {
    const res = await fetch(`${server.url}/api/orders/TEST`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('http://evil.example');
  });

  it('keeps private order GET out of public cache and lets catalog override', async () => {
    const order = await fetch(`${server.url}/api/orders/TEST`, {
      headers: { Origin: origin, Authorization: 'Bearer test' },
    });
    expect(order.headers.get('cache-control')).toMatch(/private/i);
    expect(order.headers.get('cache-control')).toMatch(/no-store/i);
    expect(order.headers.get('access-control-allow-origin')).toBe(origin);
    expect(order.headers.get('cross-origin-resource-policy')).toBe('cross-origin');

    const store = await fetch(`${server.url}/api/store`, { headers: { Origin: origin } });
    expect(store.headers.get('cache-control')).toMatch(/public/i);
    expect(store.headers.get('cache-control')).not.toMatch(/no-store/i);
  });
});
