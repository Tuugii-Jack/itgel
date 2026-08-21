"use client";

import { useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail, BatchArrivalVariant, BatchProduct } from "@/lib/types";

function draftKey(roundId: string, variantKey = "") {
  return `${roundId}\0${variantKey}`;
}

function parseCargo(raw: string | undefined): number {
  return Math.max(0, Math.round(Number((raw ?? "").replace(/[^\d]/g, "") || "0")));
}

/**
 * Багцын карго үнэ — барааны хэмжээ/өнгө зэрэг сонголт тус бүрээр.
 * «Бүгдэд» талбарт нэг үнэ бичвэл тухайн барааны бүх сонголтод хуулна.
 */
export function CargoFeeEditor({
  batch,
  onSaved,
}: {
  batch: AdminBatchDetail;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [fillAll, setFillAll] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const canEdit = batch.stage === "IN_TRANSIT";

  const valueOf = (p: BatchProduct, v?: BatchArrivalVariant) => {
    const key = draftKey(p.roundId, v?.key ?? "");
    if (key in draft) return draft[key] ?? "";
    if (v) return v.cargoFee ? String(v.cargoFee) : p.cargoFee ? String(p.cargoFee) : "";
    return p.cargoFee ? String(p.cargoFee) : "";
  };

  const unitOf = (p: BatchProduct, v?: BatchArrivalVariant) => parseCargo(valueOf(p, v));

  const productTotal = (p: BatchProduct) => {
    const variants = p.variants ?? [];
    if (variants.length === 0) return p.orderedQty * unitOf(p);
    return variants.reduce((sum, v) => sum + v.orderedQty * unitOf(p, v), 0);
  };

  const batchTotal = batch.products.reduce((sum, p) => sum + productTotal(p), 0);

  const applyFill = (p: BatchProduct, raw: string) => {
    const cleaned = raw.replace(/[^\d]/g, "");
    setFillAll((prev) => ({ ...prev, [p.roundId]: cleaned }));
    const variants = p.variants ?? [];
    setDraft((prev) => {
      const next = { ...prev };
      if (variants.length === 0) {
        next[draftKey(p.roundId)] = cleaned;
      } else {
        for (const v of variants) next[draftKey(p.roundId, v.key)] = cleaned;
      }
      return next;
    });
  };

  const save = async () => {
    const items = batch.products.map((p) => {
      const variants = p.variants ?? [];
      if (variants.length === 0) {
        return { roundId: p.roundId, cargoFee: unitOf(p) };
      }
      const rows = variants.map((v) => ({
        selections: v.selections,
        cargoFee: unitOf(p, v),
      }));
      return {
        roundId: p.roundId,
        cargoFee: rows[0]?.cargoFee ?? 0,
        variants: rows,
      };
    });
    setBusy(true);
    try {
      const result = await adminApi.saveBatchCargoFees(batch.id, items);
      setDraft({});
      setFillAll({});
      toast.success(
        result.ordersUpdated > 0
          ? `Карго хадгалагдлаа · ${result.ordersUpdated} захиалга шинэчлэгдлээ.`
          : "Карго хадгалагдлаа.",
      );
      await onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Карго хадгалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (batch.products.length === 0) return null;

  return (
    <Card className="mt-4 p-4">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[16px] font-medium">Карго үнэ</div>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {canEdit
              ? "Хэмжээ, өнгө зэрэг сонголт тус бүрд нэгж карго оруулна. «Бүгдэд»-д бичвэл тухайн барааны бүх сонголтод хуулна. Агуулахад орсны дараа солих боломжгүй."
              : "Агуулахад орсон тул карго үнийг өөрчлөх боломжгүй."}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => void save()} loading={busy}>
            Карго хадгалах
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {batch.products.map((p) => {
          const variants = p.variants ?? [];
          return (
            <div key={p.roundId}>
              <div className="mb-2 flex flex-wrap items-center gap-2.5">
                <ProductImage
                  src={p.image}
                  alt={p.name}
                  className="h-9 w-9 shrink-0 rounded-[8px]"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{p.name}</div>
                  <div className="text-[12px] text-muted">
                    {p.orderedQty} ш · {p.customerCount} хүн
                  </div>
                </div>
                {canEdit && variants.length > 1 && (
                  <div className="w-[140px] shrink-0">
                    <div className="mb-1 text-[12px] text-muted">Бүгдэд ₮</div>
                    <Input
                      value={fillAll[p.roundId] ?? ""}
                      onChange={(v) => applyFill(p, v)}
                      placeholder="Хуулах"
                      inputMode="numeric"
                    />
                  </div>
                )}
                <div className="w-[110px] text-right">
                  <div className="text-[12px] text-muted">Нийт</div>
                  <div className="tnum text-[15px] font-medium">{money(productTotal(p))}</div>
                </div>
              </div>

              {variants.length === 0 ? (
                <div className="flex items-center gap-3 rounded-[8px] border border-line px-3 py-2">
                  <div className="min-w-0 flex-1 text-[14px] text-ink-2">Сонголтгүй</div>
                  {canEdit ? (
                    <div className="w-[140px]">
                      <Input
                        value={valueOf(p)}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            [draftKey(p.roundId)]: v.replace(/[^\d]/g, ""),
                          }))
                        }
                        placeholder="0"
                        inputMode="numeric"
                      />
                    </div>
                  ) : (
                    <div className="tnum text-[15px]">{p.cargoFee ? money(p.cargoFee) : "—"}</div>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[8px] border border-line">
                  <div className="grid grid-cols-[minmax(0,1fr)_72px_140px_110px] gap-2 border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
                    <span>Сонголт</span>
                    <span className="text-right">Ширхэг</span>
                    <span className="text-right">Нэгж карго ₮</span>
                    <span className="text-right">Нийт</span>
                  </div>
                  {variants.map((v) => {
                    const unit = unitOf(p, v);
                    return (
                      <div
                        key={v.key}
                        className="grid grid-cols-[minmax(0,1fr)_72px_140px_110px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
                      >
                        <div className="min-w-0 truncate text-[14px]">{v.label}</div>
                        <div className="tnum text-right text-[13px]">{v.orderedQty}</div>
                        {canEdit ? (
                          <Input
                            value={valueOf(p, v)}
                            onChange={(val) =>
                              setDraft((prev) => ({
                                ...prev,
                                [draftKey(p.roundId, v.key)]: val.replace(/[^\d]/g, ""),
                              }))
                            }
                            placeholder="0"
                            inputMode="numeric"
                          />
                        ) : (
                          <div className="tnum text-right text-[13px]">
                            {unit ? money(unit) : "—"}
                          </div>
                        )}
                        <div className="tnum text-right text-[14px] font-medium">
                          {money(v.orderedQty * unit)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[14px] text-ink-2">Багцын нийт карго</span>
        <span className="tnum text-[18px] font-medium">{money(batchTotal)}</span>
      </div>
    </Card>
  );
}
