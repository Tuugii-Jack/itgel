"use client";

import { useRef, useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  ImagePlaceholder,
  Input,
  Spinner,
  Textarea,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { IMAGE_SIZE_HINT, assertImageUnderLimit, prepareAdminImage } from "@/lib/imageUpload";
import { OPTION_PRESETS } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { AdminCategory, AdminProduct, ProductOption, SizeChartRow } from "@/lib/types";

/**
 * Каталогийн бараа — үндсэн мэдээлэл + уян хатан сонголт.
 * Үнэ, огноо, төлөв нь гаргалтаар тусад нь үүснэ.
 */
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
  const [options, setOptions] = useState<ProductOption[]>(() => {
    if (product?.options?.length) return product.options.map((o) => ({ ...o, values: [...o.values] }));
    const legacy: ProductOption[] = [];
    if (product?.sizes?.length) legacy.push({ name: "Хэмжээ", values: [...product.sizes] });
    if (product?.colors?.length) legacy.push({ name: "Өнгө", values: [...product.colors] });
    return legacy;
  });
  const [sizeChart, setSizeChart] = useState<SizeChartRow[]>(product?.sizeChart ?? []);
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Шинэ бараа дээр зураг нэмэхэд эхлээд үүсгэсэн draft id. */
  const [productId, setProductId] = useState<string | null>(product?.id ?? null);

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
    sizeChart: sizeChart.map((row) => ({
      size: row.size,
      heightRange: row.heightRange,
      chestCm: row.chestCm,
    })),
  });

  /** Зураг upload-д id хэрэгтэй тул байхгүй бол draft үүсгэнэ. */
  const ensureProductId = async (): Promise<string> => {
    if (productId) return productId;
    if (!categoryId) throw new Error("Эхлээд ангилал сонгоно уу.");
    const created = await adminApi.createProduct(buildTemplate([]));
    setProductId(created.id);
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
    setBusy(true);
    setError(null);
    try {
      const template = buildTemplate(images);
      // Хэрэглэгчийн нэрийг template-д баталгаажуулна (draft «Шинэ бараа» байж болно).
      template.name = name.trim();

      if (productId) await adminApi.updateProduct(productId, template);
      else await adminApi.createProduct(template);

      toast.success(productId ? "Бараа хадгалагдлаа." : "Бараа үүслээ.");
      await onSaved();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic|bmp)$/i.test(f.name));
    if (list.length === 0) {
      const message = "Зөвхөн зураг файл сонгоно уу.";
      setError(message);
      toast.error(message);
      return;
    }

    const room = 12 - images.length;
    if (room <= 0) {
      const message = "Нэг бараанд дээд тал нь 12 зураг.";
      setError(message);
      toast.error(message);
      return;
    }

    const batch = list.slice(0, room);
    if (list.length > room) {
      toast.error(`Зөвхөн ${room} зураг нэмэгдлээ (дээд хязгаар 12).`);
    }

    setUploading(true);
    setError(null);
    try {
      const id = await ensureProductId();
      let next = [...images];
      let ok = 0;
      for (const file of batch) {
        const webp = await prepareAdminImage(file);
        assertImageUnderLimit(webp);
        const stored = await adminApi.uploadImage(id, webp);
        next = [...next, stored.publicUrl];
        setImages(next);
        ok += 1;
      }
      await adminApi.saveImages(id, next);
      toast.success(ok === 1 ? "Зураг нэмэгдлээ." : `${ok} зураг нэмэгдлээ.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Зураг байршуулж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const persistImages = async (next: string[]) => {
    setImages(next);
    if (!productId) return;
    try {
      await adminApi.saveImages(productId, next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Дараалал хадгалагдаагүй.");
    }
  };

  const moveImage = async (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return;
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    await persistImages(next);
  };

  const removeImage = async (url: string) => {
    const next = images.filter((i) => i !== url);
    setImages(next);
    if (productId) {
      try {
        await adminApi.saveImages(productId, next);
        toast.success("Зураг хасагдлаа.");
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Зураг хасаж чадсангүй.");
      }
    }
  };

  const addOption = (preset?: string) => {
    const nameHint = preset ?? "";
    if (preset && options.some((o) => o.name === preset)) return;
    setOptions((prev) => [...prev, { name: nameHint, values: [] }]);
  };

  return (
    <div className="max-w-[760px]">
      <PageHead
        title={product ? "Бараа засах" : "Шинэ бараа"}
        hint="Зөвхөн каталогийн мэдээлэл. Үнэ, огноог дараа нь гаргалтаар тавина."
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
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[15px] font-medium">Сонголт</div>
              <p className="m-0 text-[13px] text-muted">
                Бараанд тохирох төрөл нэмнэ үү (хоосон бол сонголтгүй). Үнийг
                гаргалт нээхэд хэмжээ/утга тус бүрээр тавина.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => addOption()}>
              Төрөл нэмэх
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {OPTION_PRESETS.map((preset) => {
              const used = options.some((o) => o.name === preset);
              return (
                <Button
                  key={preset}
                  size="sm"
                  variant="ghost"
                  disabled={used}
                  onClick={() => addOption(preset)}
                >
                  + {preset}
                </Button>
              );
            })}
          </div>

          {options.length === 0 && (
            <p className="m-0 text-[13px] text-muted">Сонголт байхгүй — шууд захиална.</p>
          )}

          {options.map((opt, index) => (
            <div key={index} className="rounded-[8px] border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    value={opt.name}
                    onChange={(v) =>
                      setOptions((prev) =>
                        prev.map((o, i) => (i === index ? { ...o, name: v } : o)),
                      )
                    }
                    placeholder="Төрлийн нэр (ж: Багтаамж)"
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                >
                  Хасах
                </Button>
              </div>
              <ChipEditor
                values={opt.values}
                onChange={(values) =>
                  setOptions((prev) =>
                    prev.map((o, i) => (i === index ? { ...o, values } : o)),
                  )
                }
                placeholder="Утга нэмэх…"
              />
            </div>
          ))}
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
          <p className="m-0 text-[12px] text-muted">Хувцас гэх мэтэд л хэрэгтэй — хоосон орхиж болно.</p>
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
          <div>
            <div className="text-[15px] font-medium">Зураг</div>
            <p className="m-0 text-[13px] text-muted">
              Эхний зураг дэлгүүрт гол зураг. Чирж эсвэл сумаар байрлуулна.
            </p>
          </div>
          <div className="relative flex flex-wrap gap-2">
            {images.map((url, index) => (
              <div
                key={`${url}-${index}`}
                draggable={!uploading}
                onDragStart={(e) => {
                  dragFrom.current = index;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(index));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragFrom.current ?? Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
                  dragFrom.current = null;
                  if (Number.isInteger(from)) void moveImage(from, index);
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                }}
                className="relative h-24 w-24 cursor-grab overflow-hidden rounded-[8px] border border-line active:cursor-grabbing"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="pointer-events-none h-full w-full object-cover" />
                {index === 0 && (
                  <span className="absolute left-1 top-1 rounded-[4px] bg-bg/90 px-1 text-[10px] text-ink">
                    Гол
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeImage(url)}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Зураг устгах"
                  disabled={uploading}
                  className="absolute right-1 top-1 h-6 w-6 cursor-pointer rounded-full border border-line bg-bg text-[12px] disabled:opacity-40"
                >
                  ×
                </button>
                {images.length > 1 && (
                  <div className="absolute inset-x-1 bottom-1 flex justify-between">
                    <button
                      type="button"
                      aria-label="Зүүн тийш"
                      disabled={uploading || index === 0}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => void moveImage(index, index - 1)}
                      className="h-6 w-6 cursor-pointer rounded-[4px] border border-line bg-bg text-[12px] disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label="Баруун тийш"
                      disabled={uploading || index === images.length - 1}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => void moveImage(index, index + 1)}
                      className="h-6 w-6 cursor-pointer rounded-[4px] border border-line bg-bg text-[12px] disabled:opacity-30"
                    >
                      →
                    </button>
                  </div>
                )}
              </div>
            ))}
            {images.length === 0 && !uploading && (
              <ImagePlaceholder className="h-24 w-24 rounded-[8px] border border-line" />
            )}
            {uploading && (
              <div className="flex h-24 w-24 flex-col items-center justify-center gap-2 rounded-[8px] border border-line bg-surface">
                <Spinner className="text-ink-2" />
                <span className="text-[11px] text-muted">WebP…</span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploading || !categoryId || images.length >= 12}
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void upload(files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!categoryId || images.length >= 12}
              loading={uploading}
              onClick={() => fileRef.current?.click()}
              className="self-start"
            >
              {uploading ? "Байршуулж байна…" : "Зураг нэмэх"}
            </Button>
            <p className="m-0 text-[12px] text-muted">
              {!categoryId
                ? "Зураг нэмэхийн тулд ангилал сонгоно уу."
                : images.length >= 12
                  ? "Дээд тал нь 12 зураг."
                  : `Олон зураг сонгож болно → автоматаар WebP. ${IMAGE_SIZE_HINT}`}
            </p>
          </div>
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

function ChipEditor({
  values,
  onChange,
  placeholder,
}: {
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
          <Input
            value={draft}
            onChange={setDraft}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              add();
            }}
          />
        </div>
        <Button variant="outline" onClick={add} disabled={!draft.trim()}>
          Нэмэх
        </Button>
      </div>
    </div>
  );
}
