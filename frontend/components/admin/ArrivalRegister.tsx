"use client";

import { useMemo, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Input } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type {
  AdminBatchDetail,
  ArrivalPreview,
  BatchArrivalVariant,
  BatchProduct,
} from "@/lib/types";

function draftKey(roundId: string, variantKey: string) {
  return `${roundId}\0${variantKey}`;
}

type NoteKind = "DAMAGED" | "SHORT" | "EXCESS";

/**
 * Энэ удаа ирсэн тоог мөр бүрээр оруулна.
 * Preview-ээр FIFO хуваарилалтыг хараад батална. Дараагийн ирэлт үлдсэнийг нэмнэ.
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
  const [preview, setPreview] = useState<ArrivalPreview | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [noteKind, setNoteKind] = useState<NoteKind>("DAMAGED");
  const [noteQty, setNoteQty] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteRoundId, setNoteRoundId] = useState("");
  const [noteKey, setNoteKey] = useState("");

  const linked = (batch.products ?? []).some((p) => (p.variants?.length ?? 0) > 0);
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
  const canReceive = linked && remainingTotal > 0;
  const canCorrect = linked && (batch.stage === "IN_TRANSIT" || batch.stage === "AT_WAREHOUSE");
  const canEdit = correcting ? canCorrect : canReceive;
  const products = batch.products.filter((p) => (p.variants?.length ?? 0) > 0);
  const firstVariant = products[0]?.variants?.[0];

  const addValueOf = (p: BatchProduct, v: BatchArrivalVariant) => {
    const key = draftKey(p.roundId, v.key);
    if (key in draft) return draft[key] ?? "";
    return "";
  };

  const totalValueOf = (p: BatchProduct, v: BatchArrivalVariant) => {
    const key = draftKey(p.roundId, v.key);
    if (key in draft) return draft[key] ?? "";
    return String(v.arrivedQty);
  };

  const collectAdds = () => {
    const lines: { roundId: string; selections: Record<string, string>; addQty: number }[] = [];
    for (const p of batch.products) {
      for (const v of p.variants ?? []) {
        const raw = addValueOf(p, v);
        const addQty = Math.max(0, Math.round(Number(raw.replace(/\D/g, "") || "0")));
        if (addQty <= 0) continue;
        lines.push({ roundId: p.roundId, selections: v.selections, addQty });
      }
    }
    return lines;
  };

  const collectTotals = () => {
    const lines: { roundId: string; selections: Record<string, string>; arrivedQty: number }[] = [];
    for (const p of batch.products) {
      for (const v of p.variants ?? []) {
        const raw = totalValueOf(p, v);
        const arrivedQty = Math.max(0, Math.round(Number(raw.replace(/\D/g, "") || "0")));
        if (arrivedQty === v.arrivedQty) continue;
        lines.push({ roundId: p.roundId, selections: v.selections, arrivedQty });
      }
    }
    return lines;
  };

  const extraNotes = () => {
    const qty = Math.max(0, Math.round(Number(noteQty.replace(/\D/g, "") || "0")));
    const roundId = noteRoundId || products[0]?.roundId || "";
    if (!roundId || qty <= 0 || !noteText.trim()) return [];
    const product = batch.products.find((p) => p.roundId === roundId);
    const variant =
      product?.variants?.find((v) => v.key === noteKey) ?? product?.variants?.[0];
    if (!variant) return [];
    return [
      {
        roundId,
        selections: variant.selections,
        kind: noteKind,
        qty,
        note: noteText.trim(),
      },
    ];
  };

  const runPreview = async () => {
    const lines = collectAdds();
    if (lines.length === 0) {
      toast.error("Энэ удаа ирсэн тоо оруулна уу.");
      return;
    }
    setBusy(true);
    try {
      setPreview(await adminApi.previewBatchArrivals(batch.id, lines));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хуваарилалт харуулж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const confirmAdds = async () => {
    if (!preview) {
      toast.error("Эхлээд хуваарилалтыг шалгана уу.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const result = await adminApi.registerBatchArrivals(batch.id, {
        lines: preview.lines.map((line) => ({
          roundId: line.roundId,
          selections: line.selections,
          addQty: line.addQty,
        })),
        expected: preview.expected,
        notes: extraNotes(),
      });
      setDraft({});
      setPreview(null);
      setNoteQty("");
      setNoteText("");
      const parts: string[] = [];
      if (result.allocated > 0) parts.push(`${result.allocated} ш хуваариллаа`);
      if (result.ordersArrived > 0) parts.push(`${result.ordersArrived} захиалгад ирсэн`);
      toast.success(parts.join(" · ") || "Хүлээн авлаа.");
      await onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setPreview(null);
        toast.error(e.message);
        await onSaved();
      } else {
        toast.error(e instanceof ApiError ? e.message : "Бүртгэж чадсангүй.");
      }
    } finally {
      setBusy(false);
    }
  };

  const saveCorrection = async () => {
    const lines = collectTotals();
    if (lines.length === 0) {
      toast.error("Өөрчлөгдсөн тоо алга.");
      return;
    }
    const decreasing = lines.some((line) => {
      const product = batch.products.find((p) => p.roundId === line.roundId);
      const variant = (product?.variants ?? []).find((v) => {
        const left = Object.entries(v.selections).sort().join();
        const right = Object.entries(line.selections).sort().join();
        return left === right;
      });
      return (variant?.arrivedQty ?? 0) > line.arrivedQty;
    });
    if (decreasing && !reason.trim()) {
      toast.error("Ирсэн тоог багасгахдаа шалтгаан бичнэ.");
      return;
    }
    setBusy(true);
    try {
      const result = await adminApi.registerBatchArrivals(batch.id, {
        lines,
        reason: reason.trim() || undefined,
        notes: extraNotes(),
      });
      setDraft({});
      setReason("");
      setNoteQty("");
      setNoteText("");
      const parts: string[] = [];
      if (result.allocated > 0) parts.push(`${result.allocated} ш хуваариллаа`);
      if (result.released > 0) parts.push(`${result.released} ш буцаалаа`);
      if (result.ordersArrived > 0) parts.push(`${result.ordersArrived} захиалгад ирсэн`);
      if (result.ordersReverted > 0) parts.push(`${result.ordersReverted} захиалга дахин хүлээнэ`);
      toast.success(parts.join(" · ") || "Заслаа.");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Засаж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (products.length === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[16px] font-medium">
            {arrivedTotal > 0 && remainingTotal > 0 ? "Үлдсэн ачаа хүлээн авах" : "Ачаа хүлээн авах"}
          </div>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {correcting
              ? "Алдаа залруулах: нийт ирсэн тоог засана. Өмнөх олголт, төлбөр буцаахгүй."
              : canReceive
                ? "Мөр бүрт хүлээгдэж буй, өмнө ирсэн, дутуу, «Энэ удаа ирсэн» тоо харагдана. Нэмэгдэх тоо л хуваарилагдана."
                : remainingTotal <= 0
                  ? `Бүх холбосон бараа ирсэн. Ирсэн ${arrivedTotal} ш.`
                  : `Ирсэн ${arrivedTotal} ш · дутуу ${remainingTotal} ш.`}
          </p>
        </div>
        {canCorrect && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCorrecting((v) => !v);
              setDraft({});
              setPreview(null);
            }}
          >
            {correcting ? "Ирэлт рүү" : "Нийт тоог засах"}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {products.map((p) => (
          <ProductArrivalRows
            key={p.roundId}
            product={p}
            valueOf={(v) => (correcting ? totalValueOf(p, v) : addValueOf(p, v))}
            canEdit={correcting ? canCorrect : canReceive}
            remainingHint={!correcting}
            onChange={(key, value) => {
              setPreview(null);
              setDraft((prev) => ({ ...prev, [draftKey(p.roundId, key)]: value.replace(/\D/g, "") }));
            }}
          />
        ))}
      </div>

      {canReceive && !correcting && preview && (
        <div className="mt-4 rounded-[10px] border border-line bg-surface p-3">
          <div className="text-[14px] font-medium">Хуваарилалтын preview</div>
          <p className="mt-1 mb-3 text-[13px] text-muted">{preview.fifoNote}</p>
          {preview.lines.map((line) => (
            <div key={`${line.roundId}-${line.label}`} className="mb-3 last:mb-0">
              <div className="text-[13px]">
                {line.label || "Үндсэн"} · +{line.addQty} ш
              </div>
              {line.allocations.map((row) => (
                <div key={row.orderId} className="tnum mt-1 text-[13px] text-ink-2">
                  {row.code}: +{row.add} ш
                  {row.fullyArrived ? " · бүрэн" : ` · үлдсэн ${row.remainingAfter}`}
                </div>
              ))}
              {line.stillWaiting.length > 0 && (
                <div className="mt-1 text-[13px] text-warn">
                  Дутуу үлдэх: {line.stillWaiting.map((w) => `${w.code} (${w.remaining})`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(canReceive || canCorrect) && (
        <div className="mt-4 rounded-[10px] border border-line p-3">
          <div className="text-[14px] font-medium">Гэмтэл / зөрүү</div>
          <p className="mt-1 mb-2 text-[12px] text-muted">
            Борлуулах үлдэгдэл, төлбөрт автоматаар нөлөөлөхгүй. Зөвхөн бүртгэл.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              className="h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
              value={noteRoundId || products[0]?.roundId || ""}
              onChange={(e) => {
                setNoteRoundId(e.target.value);
                setNoteKey("");
              }}
            >
              {products.map((p) => (
                <option key={p.roundId} value={p.roundId}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
              value={noteKey || firstVariant?.key || ""}
              onChange={(e) => setNoteKey(e.target.value)}
            >
              {(products.find((p) => p.roundId === (noteRoundId || products[0]?.roundId))?.variants ?? []).map(
                (v) => (
                  <option key={v.key} value={v.key}>
                    {v.label || "Үндсэн"}
                  </option>
                ),
              )}
            </select>
            <select
              className="h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
              value={noteKind}
              onChange={(e) => setNoteKind(e.target.value as NoteKind)}
            >
              <option value="DAMAGED">Гэмтэлтэй</option>
              <option value="SHORT">Дутуу</option>
              <option value="EXCESS">Илүү</option>
            </select>
            <Input value={noteQty} onChange={setNoteQty} inputMode="numeric" placeholder="Тоо" />
          </div>
          <div className="mt-2">
            <Input value={noteText} onChange={setNoteText} placeholder="Тайлбар" />
          </div>
        </div>
      )}

      {canCorrect && correcting && (
        <div className="mt-3">
          <Input value={reason} onChange={setReason} placeholder="Засварлах шалтгаан" />
        </div>
      )}

      {((canReceive && !correcting) || (canCorrect && correcting)) && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {correcting ? (
            <Button onClick={() => void saveCorrection()} loading={busy} className="min-w-[160px]">
              Засвар хадгалах
            </Button>
          ) : preview ? (
            <Button onClick={() => void confirmAdds()} loading={busy} className="min-w-[160px]">
              {arrivedTotal > 0 ? "Үлдсэн ачаа хүлээн авах" : "Ачаа хүлээн авах"}
            </Button>
          ) : (
            <Button onClick={() => void runPreview()} loading={busy} className="min-w-[160px]">
              Хуваарилалт шалгах
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function ProductArrivalRows({
  product,
  valueOf,
  canEdit,
  remainingHint,
  onChange,
}: {
  product: BatchProduct;
  valueOf: (v: BatchArrivalVariant) => string;
  canEdit: boolean;
  remainingHint: boolean;
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
        <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_88px_56px] gap-2 border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
          <span>SKU / өнгө / хэмжээ</span>
          <span className="text-right">Хүлээгдэж</span>
          <span className="text-right">Өмнө ирсэн</span>
          <span className="text-right">{remainingHint ? "Энэ удаа" : "Нийт ирсэн"}</span>
          <span className="text-right">Дутуу</span>
        </div>
        {variants.map((v: BatchArrivalVariant) => {
          const locked = v.handedOverQty ?? 0;
          const raw = valueOf(v);
          const entered = Math.max(0, Math.round(Number(raw.replace(/\D/g, "") || "0")));
          const remaining = remainingHint
            ? Math.max(0, v.remainingQty - entered)
            : Math.max(0, v.orderedQty - entered);
          const done = remainingHint ? v.remainingQty <= 0 : remaining <= 0;
          const rowEditable = canEdit && (remainingHint ? v.remainingQty > 0 : true);
          return (
            <div
              key={v.key}
              className="grid grid-cols-[minmax(0,1fr)_64px_64px_88px_56px] items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[14px]">{v.label || "Үндсэн"}</div>
                {locked > 0 && (
                  <div className="text-[12px] text-muted">{locked} ш өгсөн</div>
                )}
              </div>
              <div className="tnum text-right text-[13px]">
                {remainingHint ? v.remainingQty : v.orderedQty}
              </div>
              <div className="tnum text-right text-[13px]">{v.arrivedQty}</div>
              {rowEditable ? (
                <Input
                  value={raw}
                  onChange={(val) => onChange(v.key, val)}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={`${product.name} ${v.label || "үндсэн"} энэ удаа ирсэн`}
                />
              ) : (
                <div className="tnum text-right text-[13px] text-muted">
                  {remainingHint && done ? "Бүрэн" : remainingHint ? "—" : v.arrivedQty}
                </div>
              )}
              <div className={`tnum text-right text-[13px] ${done ? "text-ok" : "text-warn"}`}>
                {remainingHint && done ? 0 : remaining}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
