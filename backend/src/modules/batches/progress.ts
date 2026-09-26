import type { BatchStage } from '@prisma/client';

/** Жагсаалтын ажиллагааны төлөв — Batch.stage-ийг солихгүй. */
export type BatchProgress = 'in_transit' | 'partial' | 'complete' | 'mismatch';

export const BATCH_PROGRESS_LABEL: Record<BatchProgress, string> = {
  in_transit: 'Замд яваа',
  partial: 'Хэсэгчлэн ирсэн',
  complete: 'Бүрэн ирсэн',
  mismatch: 'Зөрүүтэй',
};

export function batchProgressOf(input: {
  stage: BatchStage;
  orderedQty: number;
  arrivedQty: number;
  unlinkedQty?: number;
}): BatchProgress {
  const unlinked = Math.max(0, input.unlinkedQty ?? 0);
  if (unlinked > 0) return 'mismatch';
  const ordered = Math.max(0, input.orderedQty);
  const arrived = Math.max(0, input.arrivedQty);
  if (arrived > ordered) return 'mismatch';
  if (ordered > 0 && arrived < ordered && (input.stage === 'AT_WAREHOUSE' || input.stage === 'DONE')) {
    return 'mismatch';
  }
  if (ordered <= 0) return input.stage === 'IN_TRANSIT' ? 'in_transit' : 'complete';
  if (arrived <= 0) return 'in_transit';
  if (arrived < ordered) return 'partial';
  return 'complete';
}

export function batchProgressLabel(progress: BatchProgress, unlinkedQty = 0): string {
  if (unlinkedQty > 0) return 'Холбоос дутуу';
  return BATCH_PROGRESS_LABEL[progress];
}
