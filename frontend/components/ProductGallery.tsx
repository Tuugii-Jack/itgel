"use client";

import { useState } from "react";
import { ProductImage } from "@/components/ProductImage";

/**
 * Барааны олон зурагтай галерей.
 *
 * Мобайл дээр гол зураг дээр, мини зургууд доор нь мөр болж жагсана.
 * Laptop дээр дизайны дагуу мини зургууд зүүн талын 88px баганад орно.
 * Мини зураг дээр дарахад тэр нь гол зураг болно.
 */
export function ProductGallery({
  images,
  alt,
  className = "",
}: {
  images: (string | null | undefined)[];
  alt: string;
  className?: string;
}) {
  const list = images.length > 0 ? images : [null];
  const [active, setActive] = useState(0);
  const index = Math.min(active, list.length - 1);

  // Одоо гол зурган дээр харагдаж буйгаас бусад нь жижиг талбарт орно.
  const thumbnails = list
    .map((src, i) => ({ src, i }))
    .filter(({ i }) => i !== index);

  const hasThumbs = thumbnails.length > 0;

  return (
    <div
      className={`flex flex-col gap-2.5 ${
        hasThumbs ? "lg:grid lg:grid-cols-[88px_minmax(0,1fr)] lg:items-start lg:gap-4" : ""
      } ${className}`}
    >
      {/* Мини зургууд — мобайл дээр доор, laptop дээр зүүн баганад */}
      {hasThumbs && (
        <div className="no-scrollbar order-2 flex gap-2 overflow-x-auto lg:order-1 lg:flex-col lg:gap-3 lg:overflow-visible">
          {thumbnails.map(({ src, i }) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${alt} — зураг ${i + 1}`}
              className="h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border border-line transition-colors hover:border-primary-muted lg:h-[88px] lg:w-[88px]"
            >
              <ProductImage src={src} alt={`${alt} ${i + 1}`} className="h-full w-full" />
            </button>
          ))}
        </div>
      )}

      {/* Гол зураг — эхний (эсвэл сонгосон) зураг том харагдана */}
      <div className="relative order-1 aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-surface lg:order-2">
        <ProductImage src={list[index]} alt={alt} className="h-full w-full" />
      </div>
    </div>
  );
}
