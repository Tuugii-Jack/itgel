"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { ProductImage } from "@/components/ProductImage";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { IMAGE_SIZE_HINT, assertImageUnderLimit, prepareAdminImage } from "@/lib/imageUpload";
import { useToast } from "@/lib/toast";
import type { AdminAd } from "@/lib/types";

export default function AdsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminAd | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminApi.ads());
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (row: AdminAd) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateAd(row.id, { isActive: !row.isActive });
      toast.success(row.isActive ? "Баннер нуугдлаа." : "Баннер идэвхжлээ.");
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: AdminAd) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteAd(row.id);
      if (editing?.id === row.id) setEditing(null);
      toast.success("Баннер устлаа.");
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Устгаж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[760px]">
      <PageHead
        title="Зар, баннер"
        hint="Нүүр хуудсанд харагдах баннер зураг. Утас болон компьютер дээр responsive харагдана."
      />

      <Card className="mb-4 p-4">
        <AdForm
          key={editing?.id ?? "new"}
          initial={editing}
          sortOrder={rows.length}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            toast.success(editing ? "Баннер хадгалагдлаа." : "Баннер үүслээ.");
            await load();
          }}
          onError={(message) => {
            setError(message);
            if (message) toast.error(message);
          }}
          setBusy={setBusy}
        />
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : rows.length === 0 ? (
        <Empty>Баннер алга байна.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="h-14 w-28 shrink-0 overflow-hidden rounded-[8px] border border-line">
                <ProductImage
                  src={row.imageUrl}
                  alt={row.title || "Зар"}
                  className="h-full w-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{row.title || "Гарчиггүй"}</div>
                <div className="truncate text-[13px] text-muted">
                  {row.linkUrl ?? "Холбоосгүй"}
                </div>
              </div>
              <Badge tone={row.isActive ? "ok" : "neutral"}>
                {row.isActive ? "Идэвхтэй" : "Идэвхгүй"}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(row)}
                disabled={busy}
              >
                Засах
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggleActive(row)}
                disabled={busy}
              >
                {row.isActive ? "Нуух" : "Идэвхжүүлэх"}
              </Button>
              <Button size="sm" variant="danger" onClick={() => remove(row)} disabled={busy}>
                Устгах
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function AdForm({
  initial,
  sortOrder,
  busy,
  onCancel,
  onSaved,
  onError,
  setBusy,
}: {
  initial: AdminAd | null;
  sortOrder: number;
  busy: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
  setBusy: (v: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [draftId, setDraftId] = useState<string | null>(initial?.id ?? null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    onError(null);
    setUploading(true);
    try {
      let adId = draftId ?? initial?.id;
      if (!adId) {
        const placeholder = await adminApi.createAd({
          title: title.trim(),
          imageUrl: "https://placehold.co/1200x400?text=Uploading",
          linkUrl: linkUrl.trim() || null,
          sortOrder,
          isActive: false,
        });
        adId = placeholder.id;
        setDraftId(adId);
      }

      const webp = await prepareAdminImage(file, { maxEdge: 2400, quality: 0.85 });
      assertImageUnderLimit(webp);
      const stored = await adminApi.uploadAdImage(adId, webp);

      setImageUrl(stored.publicUrl);
      await adminApi.updateAd(adId, { imageUrl: stored.publicUrl });
      onError(null);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Зураг байршуулж чадсангүй.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!imageUrl || imageUrl.includes("Uploading")) {
      onError("Зураг байршуулна уу.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const id = draftId ?? initial?.id;
      if (id) {
        await adminApi.updateAd(id, {
          title: title.trim(),
          linkUrl: linkUrl.trim() || null,
          imageUrl,
          isActive: true,
        });
      } else {
        await adminApi.createAd({
          title: title.trim(),
          imageUrl,
          linkUrl: linkUrl.trim() || null,
          sortOrder,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[15px] font-medium">{initial ? "Баннер засах" : "Шинэ баннер"}</div>

      <Field label="Гарчиг" hint="Зургийн alt текст болон админд харагдах нэр">
        <Input value={title} onChange={setTitle} placeholder="Жишээ: Зунгийн хямдрал" />
      </Field>

      <Field label="Холбоос" hint="Дотоод (/p/...) эсвэл гадны URL. Хоосон бол дарж болохгүй.">
        <Input
          value={linkUrl}
          onChange={setLinkUrl}
          placeholder="https://... эсвэл /#order"
        />
      </Field>

      <Field label="Зураг">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {imageUrl ? (
            <div className="relative aspect-[2/1] w-full overflow-hidden rounded-[8px] border border-line sm:max-w-[280px]">
              <ProductImage src={imageUrl} alt={title || "Баннер"} className="h-full w-full" />
              {uploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/70">
                  <Spinner className="text-ink-2" />
                  <span className="text-[12px] text-muted">Байршуулж байна…</span>
                </div>
              )}
            </div>
          ) : (
            <div className="relative flex aspect-[2/1] w-full items-center justify-center rounded-[8px] border border-dashed border-line bg-surface text-[13px] text-muted sm:max-w-[280px]">
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Spinner className="text-ink-2" />
                  <span>Байршуулж байна…</span>
                </div>
              ) : (
                "Зураг сонгоно уу"
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              loading={uploading}
              disabled={uploading}
            >
              {uploading ? "Байршуулж байна…" : imageUrl ? "Зураг солих" : "Зураг сонгох"}
            </Button>
            <p className="m-0 text-[12px] text-muted">
              Дурын зураг → WebP. {IMAGE_SIZE_HINT} Зөвлөмж: 1200×400px (3:1)
            </p>
          </div>
        </div>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} loading={busy || uploading} disabled={!imageUrl}>
          {initial ? "Хадгалах" : "Нэмэх"}
        </Button>
        {initial && (
          <Button variant="ghost" onClick={onCancel} disabled={busy || uploading}>
            Болих
          </Button>
        )}
      </div>
    </div>
  );
}
