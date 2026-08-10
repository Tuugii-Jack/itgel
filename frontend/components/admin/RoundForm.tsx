"use client";

import { useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import { Badge, Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayKey, money } from "@/lib/format";
import type { AdminProduct, AdminRound, ProductStatus } from "@/lib/types";

const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "DRAFT", label: "Ноорог" },
  { value: "ACTIVE", label: "Идэвхтэй" },
  { value: "HIDDEN", label: "Нуусан" },
  { value: "CLOSED", label: "Хаагдсан" },
  { value: "SOLD_OUT", label: "Дууссан" },
];

/**
 * Барааны нэг гаргалт — үнэ, хаах огноо, үлдэгдэл, төлөв.
 *
 * `round` нь null бол ШИНЭ гаргалт («дахин гаргах»): сүүлийн тойргийн утгууд
 * анхдагчаар орох тул ихэнхдээ зөвхөн шинэ хаах огноогоо тавихад хангалттай.
 * Хуучин тойрог огт хөндөгдөхгүй — түүнээс захиалсан хүмүүсийн үнэ, амласан
 * огноо хэвээрээ үлдэнэ.
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
  // Шинэ тойрогт өмнөхийнх нь утгыг санал болгоно.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      };

      if (round) await adminApi.updateRound(round.id, body);
      else await adminApi.createRound(product.id, { ...body, note: body.note ?? undefined });

      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!round) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteRound(round.id);
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Устгаж чадсангүй.");
      setBusy(false);
    }
  };

  const nextNo = (product.rounds[0]?.roundNo ?? 0) + 1;

  return (
    <div className="max-w-[640px]">
      <PageHead
        title={round ? `${product.name} — #${round.roundNo} гаргалт` : `${product.name} — дахин гаргах`}
        hint={
          round
            ? "Энэ гаргалтын үнэ, огноог засна. Бусад гаргалт хөндөгдөхгүй."
            : `#${nextNo} гаргалт үүснэ. Өмнөх гаргалт болон түүний захиалгууд хэвээрээ үлдэнэ.`
        }
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Болих
            </Button>
            <Button onClick={save} loading={busy} disabled={sell <= 0}>
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
              <p className="m-0 text-[12px] text-muted">
                Гарт очих огноо = хаагдах өдөр + эдгээр хоног. Захиалга өгөх мөчид
                тухайн захиалганд царцаж хадгалагдана.
              </p>
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
            <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
              Гаргалт устгах
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
