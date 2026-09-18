import compression from 'compression';
import cors, { type CorsOptions } from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { API_HELMET_OPTIONS, corsMiddlewareOptions, setPrivateApiCache } from './lib/cors.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';
import { allowedWebOrigins } from './lib/sessionCookies.js';

/** Next олон порт ашигладаг — локал origin-уудыг нэмж зөвшөөрнө. */
function corsOrigin(): CorsOptions['origin'] {
  if (env.CORS_ORIGIN === '*') return true;
  return allowedWebOrigins();
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet(API_HELMET_OPTIONS));
  // JSON хариуг шахаж илгээнэ — том жагсаалтын хариу олон дахин жижгэрнэ.
  app.use(compression());
  // Хувийн API-г CDN/shared cache-д бүү хий. Нийтийн каталог өөрөө Cache-Control тавина.
  // OPTIONS-ийг no-store-оор бүү дар — preflight cache (maxAge) ажиллах ёстой.
  app.use(setPrivateApiCache);
  app.use(cors(corsMiddlewareOptions(corsOrigin())));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'itgel-backend', time: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Vercel Express preset `src/app` дээр default export шаарддаг. */
const app = createApp();
export default app;
