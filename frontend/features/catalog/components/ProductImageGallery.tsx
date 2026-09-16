"use client";

import { type RefObject } from "react";
import { Button, Card, ImagePlaceholder, Spinner } from "@/components/ui";
import { IMAGE_SIZE_HINT } from "@/lib/imageUpload";

export function ProductImageGallery({
  images,
  uploading,
  categoryId,
  fileRef,
  dragFrom,
  onUpload,
  onRemove,
  onMove,
}: {
  images: string[];
  uploading: boolean;
  categoryId: string;
  fileRef: RefObject<HTMLInputElement | null>;
  dragFrom: RefObject<number | null>;
  onUpload: (files: FileList) => void;
  onRemove: (url: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  return (
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
              if (Number.isInteger(from)) void onMove(from, index);
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
              onClick={() => onRemove(url)}
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
                  onClick={() => void onMove(index, index - 1)}
                  className="h-6 w-6 cursor-pointer rounded-[4px] border border-line bg-bg text-[12px] disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Баруун тийш"
                  disabled={uploading || index === images.length - 1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => void onMove(index, index + 1)}
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
            if (files?.length) void onUpload(files);
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
  );
}
