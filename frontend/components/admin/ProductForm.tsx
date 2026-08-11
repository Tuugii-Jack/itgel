"use client";

import { useState } from "react";
import { PageHead, Select } from "@/components/admin/shared";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  ImagePlaceholder,
  Input,
  Textarea,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
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
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const template = {
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId,
        images,
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
      };

      if (product) await adminApi.updateProduct(product.id, template);
      else await adminApi.createProduct(template);

      toast.success(product ? "Бараа хадгалагдлаа." : "Бараа үүслээ.");
      await onSaved();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!product) {
      const message = "Зураг нэмэхийн тулд эхлээд барааг хадгална уу.";
      setError(message);
      toast.error(message);
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
      toast.success("Зураг нэмэгдлээ.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Зураг байршуулж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (url: string) => {
    const next = images.filter((i) => i !== url);
    setImages(next);
    if (product) {
      try {
        await adminApi.saveImages(product.id, next);
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
                Бараанд тохирох төрөл нэмнэ үү (хоосон бол сонголтгүй).
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
          />
        </div>
        <Button variant="outline" onClick={add} disabled={!draft.trim()}>
          Нэмэх
        </Button>
      </div>
    </div>
  );
}
