"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import { OptionPriceEditor, seedOptionPriceDrafts } from "@/components/admin/OptionPriceEditor";
import { Badge, Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fromDatetimeLocal, money } from "@/lib/format";
import { pricedOptionName } from "@/lib/options";
import type { AdminProduct, ProductStatus } from "@/lib/types";

const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "DRAFT", label: "Ноорог" },
  { value: "ACTIVE", label: "Идэвхтэй" },
  { value: "HIDDEN", label: "Нуусан" },
];

export type ReleaseKind = "preorder" | "ready";

/**
 * Каталогийн бараанаас шинэ гаргалт үүсгэнэ.
 * Урьдчилсан: хаах огноо заавал. Бэлэн: үлдэгдэл. Багцтай дараа холбоно.
 */
export function ReleaseForm({
  kind,
  initialProductId,
  onClose,
  onSaved,
}: {
  kind: ReleaseKind;
  initialProductId?: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productId, setProductId] = useState(initialProductId ?? "");
  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [optionRows, setOptionRows] = useState<
    ReturnType<typeof seedOptionPriceDrafts>
  >([]);
  const [stock, setStock] = useState("0");
  const [closeAt, setCloseAt] = useState("");
  const [leadMin, setLeadMin] = useState("7");
  const [leadMax, setLeadMax] = useState("14");
  const [status, setStatus] = useState<ProductStatus>("ACTIVE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await adminApi.products({ page: 1, pageSize: 100 });
        if (cancelled) return;
        setProducts(list.data);
        const pick =
          (initialProductId && list.data.some((p) => p.id === initialProductId)
            ? initialProductId
            : list.data[0]?.id) ?? "";
        setProductId(pick);
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.";
          setError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialProductId, toast]);

  useEffect(() => {
    if (!product || seeded) return;
    const next = product.currentRound;
    if (next) {
      setCostPrice(String(next.costPrice));
      setSellPrice(String(next.sellPrice));
      setLeadMin(String(next.leadMinDays));
      setLeadMax(String(next.leadMaxDays));
      setOptionRows(
        seedOptionPriceDrafts(product.options, next.optionPrices, {
          sell: String(next.sellPrice),
          cost: String(next.costPrice),
        }),
      );
    }
    setSeeded(true);
  }, [product, seeded]);

  const cost = Number(costPrice) || 0;
  const sell = Number(sellPrice) || 0;
  const profit = sell - cost;
  const margin = sell > 0 ? Math.round((profit / sell) * 100) : 0;
  const hasOptions = (product?.options?.length ?? 0) > 0;
  const primaryKind = pricedOptionName(product?.options);
  const optionPrices = optionRows
    .filter((r) => Number(r.sell) > 0)
    .map((r) => ({
      kind: r.kind,
      value: r.value,
      sellPrice: Number(r.sell) || 0,
      costPrice: Number(r.cost) || 0,
    }));
  const primaryOk =
    !primaryKind ||
    optionRows.filter((r) => r.kind === primaryKind).every((r) => Number(r.sell) > 0);

  const title = kind === "preorder" ? "Урьдчилсан захиалга үүсгэх" : "Бэлэн бараа гаргах";
  const hint =
    kind === "preorder"
      ? "Каталогоос бараа сонгоод хаах огноо, үнэ тавина. Багцтай дараа холбоно."
      : "Каталогоос бараа сонгоод үнэ, үлдэгдэл тавина.";

  const canSave =
    Boolean(productId) &&
    primaryOk &&
    (sell > 0 || optionPrices.length > 0) &&
    (kind === "ready" || Boolean(closeAt));

  const onProductChange = (id: string) => {
    setProductId(id);
    const picked = products.find((p) => p.id === id);
    const next = picked?.currentRound;
    if (next) {
      setCostPrice(String(next.costPrice));
      setSellPrice(String(next.sellPrice));
      setLeadMin(String(next.leadMinDays));
      setLeadMax(String(next.leadMaxDays));
      setOptionRows(
        seedOptionPriceDrafts(picked?.options, next.optionPrices, {
          sell: String(next.sellPrice),
          cost: String(next.costPrice),
        }),
      );
    } else {
      setCostPrice("");
      setSellPrice("");
      setLeadMin("7");
      setLeadMax("14");
      setOptionRows(seedOptionPriceDrafts(picked?.options, undefined, { sell: "", cost: "" }));
    }
  };

  const save = async () => {
    if (!productId) return;
    setBusy(true);
    setError(null);
    try {
      const derivedSell =
        sell > 0
          ? sell
          : optionPrices.length
            ? Math.min(...optionPrices.map((p) => p.sellPrice))
            : 0;
      const derivedCost =
        cost > 0
          ? cost
          : optionPrices.find((p) => p.sellPrice === derivedSell)?.costPrice ?? 0;
      await adminApi.createRound(productId, {
        costPrice: derivedCost,
        sellPrice: derivedSell,
        stock: kind === "ready" ? Number(stock) || 0 : 0,
        closeAt:
          kind === "preorder" && closeAt ? fromDatetimeLocal(closeAt) : null,
        leadMinDays: Number(leadMin) || 0,
        leadMaxDays: Number(leadMax) || 0,
        status,
        note: note.trim() || undefined,
        optionPrices: hasOptions ? optionPrices : [],
      });
      toast.success(kind === "preorder" ? "Урьдчилсан захиалга үүслээ." : "Бэлэн бараа гарлаа.");
      await onSaved();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[640px]">
      <PageHead
        title={title}
        hint={hint}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Болих
            </Button>
            <Button onClick={save} loading={busy} disabled={!canSave || loading}>
              Гаргах
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Card className="flex flex-col gap-3 p-4">
          <Field label="Бараа" hint="Каталогийн загвар">
            <Select
              value={productId}
              onChange={onProductChange}
              options={products.map((p) => ({
                value: p.id,
                label: p.category?.name ? `${p.name} · ${p.category.name}` : p.name,
              }))}
              className="w-full"
              placeholder={loading ? "Ачаалж байна…" : "Бараа сонгох"}
            />
          </Field>
          {!loading && products.length === 0 && (
            <p className="m-0 text-[13px] text-muted">Эхлээд каталогт бараа нэмнэ үү.</p>
          )}
        </Card>

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
            {hasOptions && product && (
              <OptionPriceEditor
                options={product.options}
                rows={optionRows}
                onChange={setOptionRows}
                onFillAll={() =>
                  setOptionRows((prev) =>
                    prev.map((r) => ({ ...r, sell: sellPrice, cost: costPrice })),
                  )
                }
              />
            )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          {kind === "preorder" ? (
            <>
              <Field
                label="Захиалга хаагдах огноо, цаг"
                hint="UB цагаар. Жишээ: 8-р сарын 15, 18:00"
              >
                <input
                  type="datetime-local"
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
                Гарт очих огноо = хаагдах өдөр + эдгээр хоног. Багцтай холбохыг дараа
                багцын хуудаснаас хийнэ.
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
          <Field label="Дотоод тэмдэглэл" hint="Зөвхөн админд харагдана">
            <Textarea value={note} onChange={setNote} rows={2} />
          </Field>
        </Card>
      </div>
    </div>
  );
}
