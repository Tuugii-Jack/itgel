/**
 * R2 bucket дээр CORS policy тавина.
 *
 * Браузер зургийг presigned URL руу ШУУД PUT хийдэг тул bucket дээр CORS
 * тохируулаагүй бол админаас зураг байршуулах ажиллахгүй.
 *
 * Ажиллуулах:
 *   npx tsx scripts/r2-cors.ts                          # .env-ийн CORS_ORIGIN + localhost
 *   npx tsx scripts/r2-cors.ts https://itgel.mn         # нэмэлт домэйнтэй
 *   npx tsx scripts/r2-cors.ts --show                   # одоогийн тохиргоог харах
 */
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
  type CORSRule,
} from '@aws-sdk/client-s3';
import { env } from '../src/env.js';

if (!env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
  console.error('R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY тохируулаагүй байна.');
  process.exit(1);
}

const client = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT || undefined,
  forcePathStyle: env.R2_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const Bucket = env.R2_BUCKET;

async function show() {
  try {
    const result = await client.send(new GetBucketCorsCommand({ Bucket }));
    console.info(JSON.stringify(result.CORSRules, null, 2));
  } catch (error) {
    const name = error instanceof Error ? error.name : String(error);
    if (name === 'NoSuchCORSConfiguration') console.info('CORS тохируулаагүй байна.');
    else throw error;
  }
}

function originsFrom(extra: string[]): string[] {
  const fromEnv = env.CORS_ORIGIN === '*' ? [] : env.CORS_ORIGIN.split(',').map((o) => o.trim());
  const all = [...fromEnv, ...extra, 'http://localhost:3000'].filter(Boolean);
  return [...new Set(all)];
}

async function apply(extra: string[]) {
  const origins = originsFrom(extra);

  const rules: CORSRule[] = [
    {
      // Админ панелиас зураг байршуулах.
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedHeaders: ['content-type'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ];

  await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));

  console.info(`"${Bucket}" bucket дээр CORS тавигдлаа:`);
  for (const origin of origins) console.info(`  · ${origin}`);
  console.info('\nОдоогийн тохиргоо:');
  await show();
}

const args = process.argv.slice(2);
if (args.includes('--show')) await show();
else await apply(args.filter((a) => !a.startsWith('--')));
