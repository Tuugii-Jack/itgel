import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env.js';
import { AppError, badRequest } from '../lib/errors.js';
import { supabase } from './supabase.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type StorageProvider = 'supabase' | 'r2' | 'mock';

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSec: number;
  method: 'PUT';
  headers: Record<string, string>;
  provider: StorageProvider;
}

const r2Configured = Boolean(env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

const r2 = r2Configured
  ? new S3Client({
      // R2 дээр region нь "auto".
      region: env.R2_REGION,
      endpoint: env.R2_ENDPOINT || undefined,
      forcePathStyle: env.R2_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
      // AWS SDK v3 нь анхдагчаар `x-amz-checksum-crc32`-г гарын үсэгт оруулдаг.
      // Browser-ээс тэр header явдаггүй тул R2 дээр presigned PUT амжилтгүй болно.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  : null;

/** Тохиргоонд заасан, эсвэл бэлэн байгаа хамгийн эхний provider. */
function pickProvider(): StorageProvider {
  switch (env.STORAGE_PROVIDER) {
    case 'r2':
      if (!r2) throw new AppError(500, 'STORAGE_ERROR', 'STORAGE_PROVIDER=r2 боловч R2_* тохиргоо дутуу байна.');
      return 'r2';
    case 'supabase':
      if (!supabase) throw new AppError(500, 'STORAGE_ERROR', 'STORAGE_PROVIDER=supabase боловч SUPABASE_* дутуу байна.');
      return 'supabase';
    case 'mock':
      return 'mock';
    default:
      if (r2) return 'r2';
      if (supabase) return 'supabase';
      return 'mock';
  }
}

function r2PublicUrl(key: string): string {
  // R2 дээр энэ нь `https://pub-<hash>.r2.dev` (bucket нэр замд ордоггүй).
  if (env.R2_PUBLIC_BASE_URL) return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  if (env.R2_ENDPOINT) return `${env.R2_ENDPOINT.replace(/\/$/, '')}/${env.R2_BUCKET}/${key}`;
  return `https://${env.R2_BUCKET}.s3.${env.R2_REGION}.amazonaws.com/${key}`; // AWS S3 fallback
}

/**
 * Барааны зураг байршуулах presigned URL.
 * Клиент `uploadUrl` руу `headers`-тэйгээ PUT хийж, дараа нь
 * `PATCH /admin/products/:id/images`-ээр `publicUrl`-г бүртгэнэ.
 */
export async function presignProductImage(
  productId: string,
  contentType: string,
): Promise<PresignedUpload> {
  if (!ALLOWED_MIME.has(contentType)) {
    throw badRequest(`Зөвхөн зураг байршуулна: ${[...ALLOWED_MIME].join(', ')}`);
  }

  const key = `products/${productId}/${randomUUID()}.${EXT[contentType]}`;
  const provider = pickProvider();

  if (provider === 'r2') {
    const expiresInSec = 600;
    const uploadUrl = await getSignedUrl(
      r2!,
      new PutObjectCommand({ Bucket: env.R2_BUCKET!, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSec },
    );
    return {
      uploadUrl,
      publicUrl: r2PublicUrl(key),
      key,
      expiresInSec,
      method: 'PUT',
      headers: { 'content-type': contentType },
      provider,
    };
  }

  if (provider === 'supabase') {
    const bucket = supabase!.storage.from(env.SUPABASE_STORAGE_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(key);
    if (error || !data) {
      throw new AppError(502, 'STORAGE_ERROR', `Supabase storage алдаа: ${error?.message ?? 'тодорхойгүй'}`);
    }
    return {
      uploadUrl: data.signedUrl,
      publicUrl: bucket.getPublicUrl(key).data.publicUrl,
      key,
      // Supabase-ийн signed upload URL 2 цагийн хүчинтэй.
      expiresInSec: 2 * 60 * 60,
      method: 'PUT',
      headers: { 'content-type': contentType },
      provider,
    };
  }

  // Storage тохируулаагүй dev орчинд flow тасрахгүй байх үүднээс.
  return {
    uploadUrl: `mock://upload/${key}`,
    publicUrl: `https://placehold.co/800x800?text=${encodeURIComponent(productId)}`,
    key,
    expiresInSec: 600,
    method: 'PUT',
    headers: { 'content-type': contentType },
    provider: 'mock',
  };
}

export const storageConfigured = r2Configured || Boolean(supabase);
export const activeStorageProvider = (): StorageProvider => pickProvider();
