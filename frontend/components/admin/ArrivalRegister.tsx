"use client";

import { useMemo, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail, BatchArrivalVariant, BatchProduct } from "@/lib/types";

function draftKey(roundId: string, variantKey: string) {
  return `${roundId}\0${variantKey}`;
}

/**
 * Ирсэн нийт тоог өнгө/хэмжээ бүрээр тавина.
 * Буруу оруулсан бол тоог засаад хадгална — сүүлд хуваарилсан хүмүүсээс буцаана.
 */
export function ArrivalRegister({
  batch,
  onSaved,
}: {
  batch: AdminBatchDetail;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const canEdit = batch.stage === "IN_TRANSIT";
  const products = batch.products.filter((p) => (p.variants?.length ?? 0) > 0);

  const remainingTotal = useMemo(
    () =>
      batch.products.reduce(
        (sum, p) => sum + (p.variants ?? []).reduce((s, v) => s + v.remainingQty, 0),
        0,
      ),
    [batch.products],
  );
  const arrivedTotal = useMemo(
    () =>
      batch.products.reduce(
        (sum, p) => sum + (p.variants ?? []).reduce((s, v) => s + v.arrivedQty, 0),
        0,
      ),
    [batch.products],
  );

  const valueOf = (p: BatchProduct, v: BatchArrivalVariant) => {
    const key = draftKey(p.roundId, v.key);
    if (key in draft) return draft[key] ?? "";
    return String(v.arrivedQty);
  };

  const fillRemaining = () => {
    const next: Record<string, string> = {};
    for (const p of batch.products) {
      for (const v of p.variants ?? []) {
        next[draftKey(p.roundId, v.key)] = String(v.orderedQty);
      }
    }
    setDraft(next);
  };

  const save = async () => {
    const lines: { roundId: string; selections: Record<string, string>; arrivedQty: number }[] = [];
    for (const p of batch.products) {
      for (const v of p.variants ?? []) {
        const raw = valueOf(p, v);
        const arrivedQty = Math.max(0, Math.round(Number(raw.replace(/\D/g, "") || "0")));
        if (arrivedQty === v.arrivedQty) continue;
        lines.push({ roundId: p.roundId, selections: v.selections, arrivedQty });
      }
    }
    if (lines.length === 0) {
      toast.error("Өөрчлөгдсөн тоо алга.");
      return;
    }
    setBusy(true);
    try {
      const result = await adminApi.registerBatchArrivals(batch.id, lines);
      setDraft({});
      const parts: string[] = [];
      if (result.allocated > 0) parts.push(`${result.allocated} ш хуваариллаа`);
      if (result.released > 0) parts.push(`${result.released} ш буцаалаа`);
      if (result.ordersArrived > 0) parts.push(`${result.ordersArrived} захиалгад ирсэн`);
      if (result.ordersReverted > 0) parts.push(`${result.ordersReverted} захиалга дахин хүлээнэ`);
      if (result.unused > 0) parts.push(`${result.unused} ш захиалснаас илүү`);
      toast.success(parts.join(" · ") || "Хадгаллаа.");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Бүртгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (products.length === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[16px] font-medium">Ирсэн бараа бүртгэх</div>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {canEdit
              ? "«Ирсэн» багана нь нийт тоо. Шинэ ирэлт бол нэмээд хадгална. Буруу оруулсан бол тоог засаад хадгална — сүүлд хуваарилсан хүмүүсээс буцаана. Агуулахад шилжүүлсний дараа засагдахгүй."
              : batch.stage === "AT_WAREHOUSE"
                ? `Агуулахад орсон тул ирсэн тоо түгжигдсэн. Ирсэн ${arrivedTotal} ш · дутуу ${remainingTotal} ш.`
                : `Ирсэн ${arrivedTotal} ш · захиалсан дундаас ${remainingTotal} ш дутуу.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {remainingTotal > 0 && (
              <Button size="sm" variant="outline" onClick={fillRemaining} disabled={busy}>
                Дутууг бүгдийг
              </Button>
            )}
            <Button size="sm" onClick={() => void save()} loading={busy}>
              Хадгалах
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {products.map((p) => (
          <ProductArrivalRows
            key={p.roundId}
            product={p}
            valueOf={(v) => valueOf(p, v)}
            canEdit={canEdit}
            onChange={(key, value) =>
              setDraft((prev) => ({ ...prev, [draftKey(p.roundId, key)]: value.replace(/\D/g, "") }))
            }
          />
        ))}
      </div>

      {canEdit && (
        <div className="mt-3 flex justify-end md:hidden">
          <Button onClick={() => void save()} loading={busy}>
            Хадгалах
          </Button>
        </div>
      )}
    </Card>
  );
}

function ProductArrivalRows({
  product,
  valueOf,
  canEdit,
  onChange,
}: {
  product: BatchProduct;
  valueOf: (v: BatchArrivalVariant) => string;
  canEdit: boolean;
  onChange: (variantKey: string, value: string) => void;
}) {
  const variants = product.variants ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        <ProductImage
          src={product.image}
          alt={product.name}
          className="h-9 w-9 shrink-0 rounded-[8px]"
        />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{product.name}</div>
          <div className="text-[12px] text-muted">
            {product.orderedQty} ш · {product.customerCount} хүн
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[8px] border border-line">
        <div className="grid grid-cols-[minmax(0,1fr)_72px_96px_64px] gap-2 border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
          <span>Сонголт</span>
          <span className="text-right">Захиалсан</span>
          <span className="text-right">Ирсэн</span>
          <span className="text-right">Дутуу</span>
        </div>
        {variants.map((v: BatchArrivalVariant) => {
          const locked = v.handedOverQty ?? 0;
          const raw = valueOf(v);
          const entered = Math.max(0, Math.round(Number(raw.replace(/\D/g, "") || "0")));
          const remaining = Math.max(0, v.orderedQty - entered);
          const done = remaining <= 0;
          return (
            <div
              key={v.key}
              className="grid grid-cols-[minmax(0,1fr)_72px_96px_64px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[14px]">{v.label}</div>
                {locked > 0 && (
                  <div className="text-[12px] text-muted">{locked} ш өгсөн</div>
                )}
              </div>
              <div className="tnum text-right text-[13px]">{v.orderedQty}</div>
              {canEdit ? (
                <Input
                  value={raw}
                  onChange={(val) => onChange(v.key, val)}
                  inputMode="numeric"
                  placeholder="0"
                />
              ) : (
                <div className="tnum text-right text-[13px]">{v.arrivedQty}</div>
              )}
              <div className={`tnum text-right text-[13px] ${done ? "text-ok" : "text-warn"}`}>
                {remaining}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
