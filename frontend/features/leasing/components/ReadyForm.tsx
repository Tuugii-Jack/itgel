"use client";

import { useRef, useState } from "react";
import { useOnKeyChange } from "@/lib/syncKey";
import { PageHead, Select } from "@/components/admin/shared";
import { SkuStockEditor, seedSkuStockDrafts } from "@/features/catalog/components/SkuStockEditor";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  ImagePlaceholder,
  Input,
  Spinner,
} from "@/components/ui";
import { ProductBasicsCard } from "@/features/catalog/components/ProductBasicsCard";
import { leasingApi, ApiError } from "@/lib/api";
import { IMAGE_SIZE_HINT, assertImageUnderLimit, prepareAdminImage } from "@/lib/imageUpload";
import { OPTION_PRESETS, skuStockSum } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { AdminCategory, AdminProduct, ProductOption, ProductStatus } from "@/lib/types";

const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "DRAFT", label: "Ноорог" },
  { value: "ACTIVE", label: "Идэвхтэй" },
  { value: "HIDDEN", label: "Нуусан" },
];

export function LeasingReadyForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: AdminProduct | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const round = product?.currentRound ?? product?.rounds[0] ?? null;
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [options, setOptions] = useState<ProductOption[]>(() =>
    product?.options?.length
      ? product.options.map((o) => ({ ...o, values: [...o.values] }))
      : [],
  );
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [sellPrice, setSellPrice] = useState(round ? String(round.sellPrice) : "");
  const [stock, setStock] = useState(round ? String(round.stock) : "0");
  const [skuRows, setSkuRows] = useState(() =>
    seedSkuStockDrafts(product?.options ?? [], round?.skuStocks, true),
  );
  const [status, setStatus] = useState<ProductStatus>(round?.status ?? "ACTIVE");
  const [productId, setProductId] = useState<string | null>(product?.id ?? null);
  const [roundId, setRoundId] = useState<string | null>(round?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const skuSeedKey = `${JSON.stringify(options)}|${JSON.stringify(round?.skuStocks ?? null)}`;
  useOnKeyChange(skuSeedKey, () => {
    setSkuRows(seedSkuStockDrafts(options, round?.skuStocks, true));
  });

  const buildTemplate = (imageList: string[] = images) => ({
    name: name.trim() || "Шинэ бараа",
    description: description.trim() || undefined,
    categoryId,
    images: imageList,
    options: options
      .map((o) => ({
        name: o.name.trim(),
        values: o.values.map((v) => v.trim()).filter(Boolean),
      }))
      .filter((o) => o.name && o.values.length > 0),
  });

  const ensureProductId = async (): Promise<string> => {
    if (productId) return productId;
    if (!categoryId) throw new Error("Эхлээд ангилал сонгоно уу.");
    const created = await leasingApi.createProduct({
      ...buildTemplate([]),
      sellPrice: Number(sellPrice) || 1,
      stock: 0,
      status: "DRAFT",
    });
    setProductId(created.id);
    setRoundId(created.currentRound?.id ?? created.rounds[0]?.id ?? null);
    return created.id;
  };

  const save = async () => {
    if (!name.trim()) {
      const message = "Барааны нэр оруулна уу.";
      setError(message);
      toast.error(message);
      return;
    }
    if (!categoryId) {
      const message = "Ангилал сонгоно уу.";
      setError(message);
      toast.error(message);
      return;
    }
    const sell = Number(sellPrice) || 0;
    if (sell <= 0) {
      const message = "Зарах үнэ оруулна уу.";
      setError(message);
      toast.error(message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const template = { ...buildTemplate(images), name: name.trim() };
      const skuStocks = options.length
        ? skuRows.map((r) => ({ selections: r.selections, stock: Number(r.stock) || 0 }))
        : [];
      const body = {
        ...template,
        sellPrice: sell,
        stock: options.length ? skuStockSum(skuStocks) ?? 0 : Number(stock) || 0,
        skuStocks,
        status,
      };
      if (productId) {
        await leasingApi.updateProduct(productId, template);
        if (roundId) await leasingApi.updateRound(roundId, body);
      } else {
        await leasingApi.createProduct(body);
      }
      toast.success(productId ? "Бараа хадгалагдлаа." : "Бэлэн бараа нэмэгдлээ.");
      await onSaved();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic|bmp)$/i.test(f.name),
    );
    if (list.length === 0) {
      toast.error("Зөвхөн зураг файл сонгоно уу.");
      return;
    }
    setUploading(true);
    try {
      const id = await ensureProductId();
      let next = [...images];
      for (const file of list.slice(0, 12 - images.length)) {
        const webp = await prepareAdminImage(file);
        assertImageUnderLimit(webp);
        const stored = await leasingApi.uploadImage(id, webp);
        next = [...next, stored.publicUrl];
        setImages(next);
      }
      await leasingApi.saveImages(id, next);
      toast.success("Зураг нэмэгдлээ.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Зураг байршуулж чадсангүй.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-[760px]">
      <PageHead
        title={product ? "Бэлэн бараа засах" : "Бэлэн бараа нэмэх"}
        hint="Өөрийн эзэмшлийн бэлэн бараа. Дэлгүүрт бусад бэлэн бараатай адил харагдана."
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Болих
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!name.trim() || !categoryId}>
              Хадгалах
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <ProductBasicsCard
          name={name}
          onName={setName}
          description={description}
          onDescription={setDescription}
          categoryId={categoryId}
          onCategory={setCategoryId}
          categories={categories}
          descriptionRows={4}
        />
        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Зураг</div>
          <p className="m-0 text-[13px] text-muted">{IMAGE_SIZE_HINT}</p>
          <div className="flex flex-wrap gap-2">
            {images.map((url) => (
              <button
                key={url}
                type="button"
                className="relative h-20 w-20 overflow-hidden rounded-[8px] border border-line"
                onClick={() => {
                  const next = images.filter((i) => i !== url);
                  setImages(next);
                  if (productId) void leasingApi.saveImages(productId, next);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 items-center justify-center rounded-[8px] border border-dashed border-line"
            >
              {uploading ? <Spinner /> : <ImagePlaceholder />}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            {OPTION_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant="ghost"
                disabled={options.some((o) => o.name === preset)}
                onClick={() => setOptions((prev) => [...prev, { name: preset, values: [] }])}
              >
                + {preset}
              </Button>
            ))}
          </div>
          {options.map((opt, index) => (
            <Field key={`${opt.name}-${index}`} label={opt.name || "Сонголт"}>
              <Input
                value={opt.values.join(", ")}
                onChange={(v) =>
                  setOptions((prev) =>
                    prev.map((row, i) =>
                      i === index ? { ...row, values: v.split(",").map((s) => s.trim()).filter(Boolean) } : row,
                    ),
                  )
                }
                placeholder="S, M, L"
              />
            </Field>
          ))}
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <Field label="Зарах үнэ">
            <Input value={sellPrice} onChange={(v) => setSellPrice(v.replace(/\D/g, ""))} inputMode="numeric" />
          </Field>
          {options.length > 0 ? (
            <SkuStockEditor options={options} rows={skuRows} onChange={setSkuRows} />
          ) : (
            <Field label="Үлдэгдэл">
              <Input value={stock} onChange={(v) => setStock(v.replace(/\D/g, ""))} inputMode="numeric" />
            </Field>
          )}
          <Field label="Төлөв">
            <Select
              value={status}
              onChange={(v) => setStatus(v as ProductStatus)}
              options={STATUSES}
              className="w-full"
            />
          </Field>
        </Card>
      </div>
    </div>
  );
}
