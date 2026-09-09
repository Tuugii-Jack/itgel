import compression from 'compression';
import cors, { type CorsOptions } from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env, isProd } from './env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';

/** Next `3000` завгүй бол `3001` руу шилждэг — локал origin-уудыг нэмж зөвшөөрнө. */
function corsOrigin(): CorsOptions['origin'] {
  if (env.CORS_ORIGIN === '*') return true;
  const allowed = new Set(
    env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  if (!isProd) {
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of [3000, 3001, 3002, 4000, 4001]) {
        allowed.add(`http://${host}:${port}`);
      }
    }
  }
  return [...allowed];
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  // JSON хариуг шахаж илгээнэ — том жагсаалтын хариу олон дахин жижгэрнэ.
  app.use(compression());
  app.use(
    cors({
      origin: corsOrigin(),
      credentials: true,
    }),
  );
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
