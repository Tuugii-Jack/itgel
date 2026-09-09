"use client";

import { useEffect, useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import { OptionPriceEditor, seedOptionPriceDrafts } from "@/components/admin/OptionPriceEditor";
import { SkuStockEditor, seedSkuStockDrafts } from "@/components/admin/SkuStockEditor";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fromDatetimeLocal } from "@/lib/format";
import { skuStockSum } from "@/lib/options";
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
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [loading, setLoading] = useState(Boolean(initialProductId));
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(!initialProductId);
  const productId = product?.id ?? "";

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
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setSearching(true);
    void adminApi
      .products({ q: query || undefined, page: 1, pageSize: 30 })
      .then((list) => {
        if (!cancelled) setHits(list.data);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, query, toast]);

  useEffect(() => {
    if (!initialProductId) return;
    let cancelled = false;
    setLoading(true);
    void adminApi
      .product(initialProductId)
      .then((picked) => {
        if (cancelled) return;
        setProduct(picked);
        applyProduct(picked);
        setPickerOpen(false);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.";
        setError(message);
        toast.error(message);
        setPickerOpen(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialProductId, toast]);

  const sell = Number(sellPrice) || 0;
  const hasOptions = (product?.options?.length ?? 0) > 0;
  const optionPrices = optionRows
    .filter((r) => Number(r.sell) > 0)
    .map((r) => ({
      selections: r.selections,
      sellPrice: Number(r.sell) || sell || 0,
      costPrice: 0,
    }));
  const skuStocks = skuRows.map((r) => ({
    selections: r.selections,
    stock: Number(r.stock) || 0,
  }));

  const title = kind === "preorder" ? "Урьдчилсан захиалга үүсгэх" : "Бэлэн бараа гаргах";
  const hint =
    kind === "preorder"
      ? "Каталогоос бараа сонгоод хаах огноо, үнэ тавина. Багцтай дараа холбоно."
      : "Каталогоос бараа сонгоод үнэ, хослол бүрийн үлдэгдэл тавина.";

  const canSave =
    Boolean(productId) &&
    (sell > 0 || optionPrices.length > 0) &&
    (kind === "ready" || Boolean(closeAt));

  const pickProduct = (picked: AdminProduct) => {
    setProduct(picked);
    applyProduct(picked);
    setPickerOpen(false);
    setSearch("");
    setError(null);
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
          <Field label="Бараа" hint="Каталогоос нэрээр хайна">
            {product && !pickerOpen ? (
              <div className="flex items-center gap-3 rounded-[8px] border border-line bg-surface px-3 py-2.5">
                {product.images[0] ? (
                  <ProductImage
                    src={product.images[0]}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-[6px] object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]">{product.name}</div>
                  {product.category?.name && (
                    <div className="truncate text-[13px] text-ink-2">{product.category.name}</div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPickerOpen(true);
                    setSearch("");
                  }}
                >
                  Өөр бараа
                </Button>
              </div>
            ) : (
              <Input
                value={search}
                onChange={setSearch}
                placeholder={loading ? "Ачаалж байна…" : "Барааны нэрээр хайх"}
                autoFocus={!initialProductId}
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hits[0]) {
                    e.preventDefault();
                    pickProduct(hits[0]);
                  }
                }}
              />
            )}
          </Field>

          {pickerOpen && (
            <div className="overflow-hidden rounded-[8px] border border-line">
              {hits.length === 0 ? (
                <div className="px-3 py-3 text-[13px] text-muted">
                  {searching
                    ? "Хайж байна…"
                    : query
                      ? `"${query}" нэртэй бараа олдсонгүй.`
                      : "Эхлээд каталогт бараа нэмнэ үү."}
                </div>
              ) : (
                <ul className="m-0 max-h-[280px] list-none overflow-y-auto p-0">
                  {hits.map((hit) => (
                    <li key={hit.id} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => pickProduct(hit)}
                        className={`flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2.5 text-left hover:bg-surface ${
                          hit.id === productId ? "bg-primary-soft" : ""
                        }`}
                      >
                        {hit.images[0] ? (
                          <ProductImage
                            src={hit.images[0]}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-[6px] object-cover"
                          />
                        ) : (
                          <span className="h-9 w-9 shrink-0 rounded-[6px] bg-surface-2" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] text-ink">{hit.name}</span>
                          {hit.category?.name && (
                            <span className="block truncate text-[12px] text-ink-2">
                              {hit.category.name}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
            <Textarea
              value={note}
              onChange={setNote}
              rows={4}
              resize="y"
              className="min-h-[120px] max-h-[70vh]"
            />
          </Field>
        </Card>
      </div>
    </div>
  );
}
