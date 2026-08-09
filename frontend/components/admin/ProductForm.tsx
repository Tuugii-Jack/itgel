"use client";

import { useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  ImagePlaceholder,
  Input,
  Textarea,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayKey, money } from "@/lib/format";
import type { AdminCategory, AdminProduct, ProductStatus, SizeChartRow } from "@/lib/types";

const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "DRAFT", label: "Ноорог" },
  { value: "ACTIVE", label: "Идэвхтэй" },
  { value: "HIDDEN", label: "Нуусан" },
  { value: "CLOSED", label: "Хаагдсан" },
  { value: "SOLD_OUT", label: "Дууссан" },
];

export function ProductForm({
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
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [costPrice, setCostPrice] = useState(String(product?.costPrice ?? ""));
  const [sellPrice, setSellPrice] = useState(String(product?.sellPrice ?? ""));
  const [stock, setStock] = useState(String(product?.stock ?? 0));
  const [isOrder, setIsOrder] = useState(product ? product.type === "order" : true);
  const [closeAt, setCloseAt] = useState(product?.closeAt ? dayKey(product.closeAt) : "");
  const [leadMin, setLeadMin] = useState(String(product?.leadMinDays ?? 7));
  const [leadMax, setLeadMax] = useState(String(product?.leadMaxDays ?? 14));
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? "DRAFT");
  const [sizes, setSizes] = useState<string[]>(product?.sizes ?? []);
  const [colors, setColors] = useState<string[]>(product?.colors ?? []);
  const [sizeChart, setSizeChart] = useState<SizeChartRow[]>(product?.sizeChart ?? []);
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
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
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId,
        costPrice: cost,
        sellPrice: sell,
        stock: Number(stock) || 0,
        closeAt: isOrder && closeAt ? new Date(`${closeAt}T00:00:00+08:00`).toISOString() : null,
        leadMinDays: Number(leadMin) || 0,
        leadMaxDays: Number(leadMax) || 0,
        status,
        images,
        sizes,
        colors,
        sizeChart: sizeChart.map((row) => ({
          size: row.size,
          heightRange: row.heightRange,
          chestCm: row.chestCm,
        })),
      };

      if (product) await adminApi.updateProduct(product.id, body);
      else await adminApi.createProduct(body);

      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
      setBusy(false);
    }
  };

  /** Presigned URL авч R2 руу шууд PUT хийнэ. */
  const upload = async (file: File) => {
    if (!product) {
      setError("Зураг нэмэхийн тулд эхлээд барааг хадгална уу.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const presigned = await adminApi.presignImage(product.id, file.type);
      const res = await fetch(presigned.uploadUrl, {
        method: "PUT",
        headers: presigned.headers,
        body: file,
      });
      if (!res.ok) throw new Error(`Байршуулалт амжилтгүй (${res.status})`);
      const next = [...images, presigned.publicUrl];
      await adminApi.saveImages(product.id, next);
      setImages(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Зураг байршуулж чадсангүй.");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (url: string) => {
    const next = images.filter((i) => i !== url);
    setImages(next);
    if (product) await adminApi.saveImages(product.id, next).catch(() => undefined);
  };

  return (
    <div className="max-w-[760px]">
      <PageHead
        title={product ? "Бараа засах" : "Шинэ бараа"}
        actions={
          <>
            <Button variant="ghost" onClick={onClose}>
              Болих
            </Button>
            <Button onClick={save} loading={busy} disabled={!name.trim() || !categoryId}>
              Хадгалах
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3 p-4">
          <Field label="Нэр">
            <Input value={name} onChange={setName} placeholder="Барааны нэр" />
          </Field>
          <Field label="Тайлбар">
            <Textarea value={description} onChange={setDescription} rows={3} />
          </Field>
          <Field label="Ангилал">
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              className="w-full"
            />
          </Field>
          <Field label="Статус">
            <Select
              value={status}
              onChange={(v) => setStatus(v as ProductStatus)}
              options={STATUSES}
              className="w-full"
            />
          </Field>
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
                Гарт очих огноо = хаагдах өдөр + эдгээр хоног. Хадгалагдахгүй, уншихад бодогдоно.
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

        <Card className="flex flex-col gap-4 p-4">
          <div className="text-[15px] font-medium">Сонголт</div>
          <ChipEditor label="Хэмжээ" values={sizes} onChange={setSizes} placeholder="S, M, L…" />
          <ChipEditor label="Өнгө" values={colors} onChange={setColors} placeholder="Хар, Цагаан…" />
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[15px] font-medium">Хэмжээсийн хүснэгт</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSizeChart((prev) => [...prev, { size: "", heightRange: "", chestCm: "" }])
              }
            >
              Мөр нэмэх
            </Button>
          </div>
          {sizeChart.map((row, index) => (
            <div key={index} className="flex gap-2">
              {(["size", "heightRange", "chestCm"] as const).map((key) => (
                <div key={key} className="flex-1">
                  <Input
                    value={row[key] ?? ""}
                    onChange={(v) =>
                      setSizeChart((prev) =>
                        prev.map((r, i) => (i === index ? { ...r, [key]: v } : r)),
                      )
                    }
                    placeholder={
                      key === "size" ? "Хэмжээ" : key === "heightRange" ? "Өндөр" : "Цээж"
                    }
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSizeChart((prev) => prev.filter((_, i) => i !== index))}
              >
                Хасах
              </Button>
            </div>
          ))}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Зураг</div>
          {!product && (
            <p className="m-0 text-[13px] text-muted">
              Зураг нэмэхийн тулд эхлээд барааг хадгална уу.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {images.map((url) => (
              <div key={url} className="relative h-24 w-24 overflow-hidden rounded-[8px] border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(url)}
                  aria-label="Зураг устгах"
                  className="absolute right-1 top-1 h-6 w-6 cursor-pointer rounded-full border border-line bg-bg text-[12px]"
                >
                  ×
                </button>
              </div>
            ))}
            {images.length === 0 && <ImagePlaceholder className="h-24 w-24 rounded-[8px] border border-line" />}
          </div>
          <label className="inline-flex">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              disabled={!product || uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            <span
              className={`inline-flex h-11 items-center rounded-[8px] border border-line px-4 text-[14px]
                ${!product || uploading ? "opacity-40" : "cursor-pointer"}`}
            >
              {uploading ? "Байршуулж байна…" : "Зураг нэмэх"}
            </span>
          </label>
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex gap-2">
          <Button onClick={save} loading={busy} disabled={!name.trim() || !categoryId}>
            Хадгалах
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Хэмжээ, өнгө — chip-ээр нэмж хасна. */
function ChipEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div>
      <div className="mb-1.5 text-[13px] text-ink-2">{label}</div>
      <div className="mb-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[14px]"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`${value} хасах`}
              className="cursor-pointer border-0 bg-transparent text-muted"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Input value={draft} onChange={setDraft} placeholder={placeholder} />
        </div>
        <Button variant="outline" onClick={add} disabled={!draft.trim()}>
          Нэмэх
        </Button>
      </div>
    </div>
  );
}
