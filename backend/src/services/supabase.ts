import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

/**
 * Supabase secret key-тэй серверийн клиент — RLS-ийг тойрдог тул
 * зөвхөн backend дотор ашиглана, хэрэглэгч рүү хэзээ ч гаргахгүй.
 */
export const supabase: SupabaseClient | null =
  env.SUPABASE_URL && env.SUPABASE_SECRET_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export const supabaseConfigured = supabase !== null;

/** Зургийн bucket байхгүй бол үүсгэнэ (нэг удаа, серверийн эхлэлд). */
export async function ensureStorageBucket(): Promise<void> {
  if (!supabase) return;

  const { data, error } = await supabase.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
  if (data && !error) return;

  const { error: createError } = await supabase.storage.createBucket(env.SUPABASE_STORAGE_BUCKET, {
    public: true,
    fileSizeLimit: '10MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  });

  if (createError) {
    console.warn(`[supabase] "${env.SUPABASE_STORAGE_BUCKET}" bucket үүсгэж чадсангүй: ${createError.message}`);
    return;
  }
  console.info(`[supabase] "${env.SUPABASE_STORAGE_BUCKET}" bucket үүслээ.`);
}
