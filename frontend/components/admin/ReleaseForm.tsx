"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import { OptionPriceEditor, seedOptionPriceDrafts } from "@/components/admin/OptionPriceEditor";
import { SkuStockEditor, seedSkuStockDrafts } from "@/components/admin/SkuStockEditor";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fromDatetimeLocal } from "@/lib/format";
import { pricedOptionName, skuStockSum } from "@/lib/options";
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

  const [sellPrice, setSellPrice] = useState("");
  const [optionRows, setOptionRows] = useState<
    ReturnType<typeof seedOptionPriceDrafts>
  >([]);
  const [skuRows, setSkuRows] = useState<ReturnType<typeof seedSkuStockDrafts>>(
    [],
  );
  const [stock, setStock] = useState("0");
  const [closeAt, setCloseAt] = useState("");
  const [status, setStatus] = useState<ProductStatus>("ACTIVE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const applyProduct = (picked: AdminProduct | null | undefined) => {
    if (!picked) {
      setSellPrice("");
      setOptionRows([]);
      setSkuRows([]);
      return;
    }
    const next = picked.currentRound;
    setSellPrice(next ? String(next.sellPrice) : "");
    setOptionRows(
      seedOptionPriceDrafts(picked.options, next?.optionPrices, {
        sell: next ? String(next.sellPrice) : "",
      }),
    );
    setSkuRows(seedSkuStockDrafts(picked.options, next?.skuStocks));
  };

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
        applyProduct(list.data.find((p) => p.id === pick) ?? list.data[0] ?? null);
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

  const sell = Number(sellPrice) || 0;
  const hasOptions = (product?.options?.length ?? 0) > 0;
  const primaryKind = pricedOptionName(product?.options);
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
  const primaryOk =
    !primaryKind ||
    optionRows.filter((r) => r.kind === primaryKind).every((r) => Number(r.sell) > 0);

  const title = kind === "preorder" ? "Урьдчилсан захиалга үүсгэх" : "Бэлэн бараа гаргах";
  const hint =
    kind === "preorder"
      ? "Каталогоос бараа сонгоод хаах огноо, үнэ тавина. Багцтай дараа холбоно."
      : "Каталогоос бараа сонгоод үнэ, хослол бүрийн үлдэгдэл тавина.";

  const canSave =
    Boolean(productId) &&
    primaryOk &&
    (sell > 0 || optionPrices.length > 0) &&
    (kind === "ready" || Boolean(closeAt));

  const onProductChange = (id: string) => {
    setProductId(id);
    applyProduct(products.find((p) => p.id === id) ?? null);
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
      await adminApi.createRound(productId, {
        costPrice: 0,
        sellPrice: derivedSell,
        stock: kind === "ready"
          ? hasOptions
            ? skuStockSum(skuStocks) ?? 0
            : Number(stock) || 0
          : 0,
        closeAt:
          kind === "preorder" && closeAt ? fromDatetimeLocal(closeAt) : null,
        status,
        note: note.trim() || undefined,
        optionPrices: hasOptions ? optionPrices : [],
        skuStocks: kind === "ready" && hasOptions ? skuStocks : [],
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
          <Field label="Зарах үнэ">
            <Input
              value={sellPrice}
              onChange={(v) => setSellPrice(v.replace(/\D/g, ""))}
              inputMode="numeric"
            />
          </Field>
            {hasOptions && product && (
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
            </>
          ) : hasOptions && product ? (
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
          <Field label="Дотоод тэмдэглэл" hint="Зөвхөн админд харагдана">
            <Textarea value={note} onChange={setNote} rows={2} />
          </Field>
        </Card>
      </div>
    </div>
  );
}
