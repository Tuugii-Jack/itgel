"use client";

import { useEffect, useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import { Badge, Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayKey, money } from "@/lib/format";
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

/**
 * Барааны нэг гаргалт — үнэ, хаах огноо, үлдэгдэл, төлөв, багц.
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

  const [costPrice, setCostPrice] = useState(String(base?.costPrice ?? ""));
  const [sellPrice, setSellPrice] = useState(String(base?.sellPrice ?? ""));
  const [stock, setStock] = useState(String(round?.stock ?? 0));
  const [isOrder, setIsOrder] = useState(base ? base.type === "order" : true);
  const [closeAt, setCloseAt] = useState(round?.closeAt ? dayKey(round.closeAt) : "");
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
      .batches({ stage: "COLLECTING", pageSize: 50 })
      .then((list) => setBatches(list.data))
      .catch(() => undefined);
  }, []);

  const cost = Number(costPrice) || 0;
  const sell = Number(sellPrice) || 0;
  const profit = sell - cost;
  const margin = sell > 0 ? Math.round((profit / sell) * 100) : 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        costPrice: cost,
        sellPrice: sell,
        stock: isOrder ? 0 : Number(stock) || 0,
        closeAt:
          isOrder && closeAt ? new Date(`${closeAt}T00:00:00+08:00`).toISOString() : null,
        leadMinDays: Number(leadMin) || 0,
        leadMaxDays: Number(leadMax) || 0,
        status,
        note: note.trim() || null,
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
    <div className="max-w-[640px]">
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
            <Button onClick={save} loading={busy} disabled={deleting || sell <= 0}>
              {round ? "Хадгалах" : "Гаргах"}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Үнэ</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Анхны үнэ (өртөг)">
              <Input
                value={costPrice}
                onChange={(v) => setCostPrice(v.replace(/\D/g, ""))}
                inputMode="numeric"
              />
            </Field>
            <Field label="Зарах үнэ">
              <Input
                value={sellPrice}
                onChange={(v) => setSellPrice(v.replace(/\D/g, ""))}
                inputMode="numeric"
              />
            </Field>
          </div>
          {sell > 0 && (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-ink-2">Ашиг</span>
              <span className="tnum">{money(profit)}</span>
              <Badge tone={margin >= 40 ? "ok" : margin >= 0 ? "neutral" : "danger"}>
                {margin}%
              </Badge>
            </div>
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
              <Field label="Захиалга хаагдах өдөр" hint="UB цагаар өдрийн эхэнд хаагдана">
                <input
                  type="date"
                  value={closeAt}
                  onChange={(e) => setCloseAt(e.target.value)}
                  className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[15px]"
                />
              </Field>
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
    </div>
  );
}
