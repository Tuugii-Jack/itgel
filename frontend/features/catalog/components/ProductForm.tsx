"use client";

import { useRef, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, ErrorNote } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { assertImageUnderLimit, prepareAdminImage } from "@/lib/imageUpload";
import { useToast } from "@/lib/toast";
import type { AdminCategory, AdminProduct, ProductOption, SizeChartRow } from "@/lib/types";
import { ProductBasicsCard } from "./ProductBasicsCard";
import { ProductImageGallery } from "./ProductImageGallery";
import { ProductOptionsEditor } from "./ProductOptionsEditor";
import { SizeChartEditor } from "./SizeChartEditor";

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
        <ProductBasicsCard
          name={name}
          onName={setName}
          description={description}
          onDescription={setDescription}
          categoryId={categoryId}
          onCategory={setCategoryId}
          categories={categories}
        />

        <ProductOptionsEditor options={options} onChange={setOptions} />

        <SizeChartEditor rows={sizeChart} onChange={setSizeChart} />

        <ProductImageGallery
          images={images}
          uploading={uploading}
          categoryId={categoryId}
          fileRef={fileRef}
          dragFrom={dragFrom}
          onUpload={(files) => void upload(files)}
          onRemove={(url) => void removeImage(url)}
          onMove={(from, to) => void moveImage(from, to)}
        />

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
