"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import { Calendar } from "@/components/shadcn/calendar";
import { OptionPriceEditor, seedOptionPriceDrafts } from "@/components/admin/OptionPriceEditor";
import { SkuStockEditor, seedSkuStockDrafts } from "@/components/admin/SkuStockEditor";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayTimeLabel, datetimeLocalKey, fromDatetimeLocal } from "@/lib/format";
import { pricedOptionName, skuStockSum } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { AdminBatch, AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "DRAFT", label: "Ноорог" },
  { value: "ACTIVE", label: "Идэвхтэй" },
  { value: "HIDDEN", label: "Нуусан" },
  { value: "CLOSED", label: "Хаагдсан" },
  { value: "SOLD_OUT", label: "Дууссан" },
  { value: "ARCHIVED", label: "Архивласан" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

function splitCloseAt(value: string): { date: Date | undefined; hour: string; minute: string } {
  if (!value || !value.includes("T")) {
    return { date: undefined, hour: "18", minute: "00" };
  }
  const [day, time] = value.split("T");
  const [h = "18", m = "00"] = (time ?? "").split(":");
  const [y, mo, d] = day!.split("-").map(Number);
  if (!y || !mo || !d) return { date: undefined, hour: h.slice(0, 2), minute: m.slice(0, 2) };
  return {
    date: new Date(y, mo - 1, d),
    hour: h.slice(0, 2),
    minute: ["00", "15", "30", "45"].includes(m.slice(0, 2)) ? m.slice(0, 2) : "00",
  };
}

function joinCloseAt(date: Date, hour: string, minute: string): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}T${hour}:${minute}`;
}

/**
 * Барааны нэг гаргалт — үнэ, хаах огноо, үлдэгдэл, төлөв, багц.
 * Desktop: зүүн форм, баруун том календарь.
 */
export function RoundForm({
  product,
  round,
  onClose,
  onSaved,
}: {
  product: AdminProduct;
  round: AdminRound | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const base = round ?? product.currentRound;

  const [sellPrice, setSellPrice] = useState(String(base?.sellPrice ?? ""));
  const [optionRows, setOptionRows] = useState(() =>
    seedOptionPriceDrafts(product.options, (round ?? product.currentRound)?.optionPrices, {
      sell: String(base?.sellPrice ?? ""),
    }),
  );
  const [skuRows, setSkuRows] = useState(() =>
    seedSkuStockDrafts(
      product.options,
      (round ?? product.currentRound)?.skuStocks,
      true,
    ),
  );
  const [stock, setStock] = useState(String(round?.stock ?? 0));
  const [isOrder, setIsOrder] = useState(base ? base.type === "order" : true);
  const [closeAt, setCloseAt] = useState(
    round?.closeAt ? datetimeLocalKey(round.closeAt) : "",
  );
  const [leadMin, setLeadMin] = useState(String(base?.leadMinDays ?? 7));
  const [leadMax, setLeadMax] = useState(String(base?.leadMaxDays ?? 14));
  const [status, setStatus] = useState<ProductStatus>(round?.status ?? "ACTIVE");
  const [note, setNote] = useState(round?.note ?? "");
  const [batchId, setBatchId] = useState(round?.batchId ?? "");
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi
      .batches({ stage: "IN_TRANSIT", pageSize: 50 })
      .then((list) => setBatches(list.data))
      .catch(() => undefined);
  }, []);

  const sell = Number(sellPrice) || 0;
  const hasOptions = (product.options?.length ?? 0) > 0;
  const primaryKind = pricedOptionName(product.options);
  const primaryRows = optionRows.filter((r) => r.kind === primaryKind);
  const primaryPriced = !primaryKind || primaryRows.every((r) => Number(r.sell) > 0);
  const optionPrices = optionRows
    .filter((r) => Number(r.sell) > 0)
    .map((r) => ({
      kind: r.kind,
      value: r.value,
      sellPrice: Number(r.sell) || sell || 0,
      costPrice: 0,
    }));
  const skuStocks = skuRows.map((r) => ({
    selections: r.selections,
    stock: Number(r.stock) || 0,
  }));
  const canSave = primaryPriced && (sell > 0 || optionPrices.length > 0);

  const { date: selectedDay, hour, minute } = useMemo(() => splitCloseAt(closeAt), [closeAt]);

  const setDay = (day: Date | undefined) => {
    if (!day) {
      setCloseAt("");
      return;
    }
    const parts = splitCloseAt(closeAt);
    setCloseAt(joinCloseAt(day, parts.hour, parts.minute));
  };

  const setTime = (nextHour: string, nextMinute: string) => {
    const parts = splitCloseAt(closeAt);
    if (!parts.date) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setCloseAt(joinCloseAt(tomorrow, nextHour, nextMinute));
      return;
    }
    setCloseAt(joinCloseAt(parts.date, nextHour, nextMinute));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const derivedSell =
        sell > 0
          ? sell
          : optionPrices.length
            ? Math.min(...optionPrices.map((p) => p.sellPrice))
            : 0;
      const body = {
        costPrice: 0,
        sellPrice: derivedSell,
        stock: isOrder ? 0 : hasOptions ? skuStockSum(skuStocks) ?? 0 : Number(stock) || 0,
        closeAt: isOrder && closeAt ? fromDatetimeLocal(closeAt) : null,
        leadMinDays: Number(leadMin) || 0,
        leadMaxDays: Number(leadMax) || 0,
        status,
        note: note.trim() || null,
        optionPrices: hasOptions ? optionPrices : [],
        skuStocks: !isOrder && hasOptions ? skuStocks : [],
        ...(isOrder ? { batchId: batchId.trim() ? batchId : null } : {}),
      };

      if (round) await adminApi.updateRound(round.id, body);
      else
        await adminApi.createRound(product.id, {
          ...body,
          note: body.note ?? undefined,
          batchId: isOrder ? body.batchId : undefined,
        });

      toast.success(round ? "Гаргалт хадгалагдлаа." : "Гаргалт үүслээ.");
      await onSaved();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!round) return;
    setDeleting(true);
    setError(null);
    try {
      await adminApi.deleteRound(round.id);
      toast.success("Гаргалт устлаа.");
      await onSaved();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Устгаж чадсангүй.";
      setError(message);
      toast.error(message);
      setDeleting(false);
    }
  };

  const nextNo = (product.rounds[0]?.roundNo ?? 0) + 1;

  const batchOptions = [
    ...batches.map((b) => ({ value: b.id, label: b.name })),
    ...(round?.batchId &&
    round.batch &&
    !batches.some((b) => b.id === round.batchId)
      ? [{ value: round.batch.id, label: `${round.batch.name} (хаагдсан)` }]
      : []),
  ];

  return (
    <div className="w-full max-w-[1100px]">
      <PageHead
        title={
          round
            ? `${product.name} — #${round.roundNo} гаргалт`
            : `${product.name} — дахин гаргах`
        }
        hint={
          round
            ? "Үнэ, огноо, багц. Багцад холбоход захиалгууд дагана; огноо солигдвол ирэх өдөр шинэчлэгдэнэ."
            : `#${nextNo} гаргалт үүснэ. Өмнөх гаргалт болон түүний захиалгууд хэвээрээ үлдэнэ.`
        }
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Болих
            </Button>
            <Button onClick={save} loading={busy} disabled={deleting || !canSave}>
              {round ? "Хадгалах" : "Гаргах"}
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="flex flex-col gap-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <Card className="flex flex-col gap-3 p-4">
            <div className="text-[15px] font-medium">Үнэ</div>
            <p className="m-0 text-[13px] text-ink-2">
              {hasOptions
                ? "Доорх хүснэгтэд хэмжээ/сонголт бүрийн зарах үнийг тавина."
                : "Энэ гаргалтын зарах үнэ."}
            </p>
            <Field label="Зарах үнэ">
              <Input
                value={sellPrice}
                onChange={(v) => setSellPrice(v.replace(/\D/g, ""))}
                inputMode="numeric"
              />
            </Field>
            {hasOptions && (
              <OptionPriceEditor
                options={product.options}
                rows={optionRows}
                onChange={setOptionRows}
                onFillAll={() =>
                  setOptionRows((prev) =>
                    prev.map((r) => ({ ...r, sell: sellPrice, cost: "0" })),
                  )
                }
              />
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <div className="text-[15px] font-medium">Төрөл</div>
            <div className="flex gap-2">
              <Button variant={isOrder ? "primary" : "outline"} onClick={() => setIsOrder(true)}>
                Захиалгын бараа
              </Button>
              <Button variant={!isOrder ? "primary" : "outline"} onClick={() => setIsOrder(false)}>
                Бэлэн бараа
              </Button>
            </div>

            {isOrder ? (
              <>
                <div className="rounded-[10px] border border-line bg-surface px-3 py-2.5 lg:hidden">
                  <div className="text-[12px] text-muted">Хаагдах хугацаа</div>
                  <div className="tnum text-[15px] font-medium">
                    {closeAt
                      ? dayTimeLabel(fromDatetimeLocal(closeAt))
                      : "Календараас сонгоно уу"}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Цаг">
                    <select
                      className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[15px]"
                      value={hour}
                      onChange={(e) => setTime(e.target.value, minute)}
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Минут">
                    <select
                      className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[15px]"
                      value={minute}
                      onChange={(e) => setTime(hour, e.target.value)}
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Хамгийн бага хоног">
                    <Input
                      value={leadMin}
                      onChange={(v) => setLeadMin(v.replace(/\D/g, ""))}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Хамгийн их хоног">
                    <Input
                      value={leadMax}
                      onChange={(v) => setLeadMax(v.replace(/\D/g, ""))}
                      inputMode="numeric"
                    />
                  </Field>
                </div>
                <Field
                  label="Ачааны багц"
                  hint="Холбоход энэ гаргалтын захиалгууд багцад орно."
                >
                  <Select
                    value={batchId}
                    onChange={setBatchId}
                    options={batchOptions}
                    placeholder="Багцгүй"
                    className="w-full"
                  />
                </Field>
              </>
            ) : hasOptions ? (
              <SkuStockEditor
                options={product.options}
                rows={skuRows}
                onChange={setSkuRows}
              />
            ) : (
              <Field label="Үлдэгдэл">
                <Input
                  value={stock}
                  onChange={(v) => setStock(v.replace(/\D/g, ""))}
                  inputMode="numeric"
                />
              </Field>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <Field label="Статус">
              <Select
                value={status}
                onChange={(v) => setStatus(v as ProductStatus)}
                options={STATUSES}
                className="w-full"
              />
            </Field>
            <Field label="Дотоод тэмдэглэл" hint="Зөвхөн админд харагдана (нийлүүлэгч гэх мэт)">
              <Textarea value={note} onChange={setNote} rows={2} />
            </Field>
          </Card>

          {round && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="text-[13px] text-ink-2">
                Захиалгагүй гаргалтыг л устгана. Захиалгатай бол статусыг «Архивласан» болгоно уу.
              </div>
              <Button variant="danger" size="sm" onClick={remove} disabled={busy} loading={deleting}>
                Гаргалт устгах
              </Button>
            </Card>
          )}
        </div>

        {/* Баруун — том календарь */}
        {isOrder && (
          <aside className="lg:sticky lg:top-4">
            <Card className="overflow-hidden border-line p-0 shadow-sm">
              <div className="border-b border-line bg-gradient-to-br from-primary-soft via-bg to-surface px-5 py-4">
                <div className="text-[13px] font-medium tracking-wide text-ink-2 uppercase">
                  Захиалга хаагдах
                </div>
                <div className="tnum mt-1 text-[22px] font-medium leading-tight text-ink">
                  {closeAt ? dayTimeLabel(fromDatetimeLocal(closeAt)) : "Өдөр сонгоно уу"}
                </div>
                <p className="mt-1 mb-0 text-[13px] text-muted">UB цаг · календарь дээр дарж өдөр сонгоно</p>
              </div>
              <div className="flex justify-center bg-bg px-3 py-4 sm:px-5 sm:py-5">
                <Calendar
                  mode="single"
                  selected={selectedDay}
                  onSelect={setDay}
                  disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                  className="w-full max-w-[360px]"
                />
              </div>
              <div className="flex gap-2 border-t border-line bg-surface px-4 py-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    setCloseAt(joinCloseAt(d, "18", "00"));
                  }}
                >
                  Маргааш 18:00
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 7);
                    setCloseAt(joinCloseAt(d, "18", "00"));
                  }}
                >
                  +7 хоног
                </Button>
              </div>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
