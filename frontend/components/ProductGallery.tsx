"use client";

import { useState, type ReactNode } from "react";
import { ProductImage } from "@/components/ProductImage";

/**
 * Барааны олон зурагтай галерей.
 *
 * Мобайл дээр гол зураг дээр, мини зургууд доор нь мөр болж жагсана.
 * Laptop дээр дизайны дагуу мини зургууд зүүн талын 88px баганад орно.
 *
 * 88px багана нь ганц зурагтай үед ч байрандаа үлдэнэ — эс тэгвээс гол зураг
 * баганы бүтэн өргөнийг эзэлж, дизайны 608px-ээс хэтэрч томордог.
 */
export function ProductGallery({
  images,
  alt,
  overlay,
  className = "",
}: {
  images: (string | null | undefined)[];
  alt: string;
  /** Гол зурган дээр байрлах зүйл (жишээ нь хаагдах хугацааны шошго). */
  overlay?: ReactNode;
  className?: string;
}) {
  const list = images.length > 0 ? images : [null];
  const [active, setActive] = useState(0);
  const index = Math.min(active, list.length - 1);
  const hasThumbs = list.length > 1;

  return (
    <div
      className={`flex flex-col gap-2.5 lg:grid lg:grid-cols-[88px_minmax(0,1fr)] lg:items-start lg:gap-4 ${className}`}
    >
      {/* Мини зургууд — мобайл дээр доор, laptop дээр зүүн баганад */}
      {hasThumbs ? (
        <div className="no-scrollbar order-2 flex gap-2 overflow-x-auto lg:order-1 lg:flex-col lg:gap-3 lg:overflow-visible">
          {list.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${alt} — зураг ${i + 1}`}
              aria-current={i === index}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border transition-colors lg:h-[88px] lg:w-[88px]
                ${i === index ? "border-primary bg-surface-2" : "border-line hover:border-primary-muted"}`}
            >
              <ProductImage src={src} alt={`${alt} ${i + 1}`} className="h-full w-full" />
            </button>
          ))}
        </div>
      ) : (
        /* Ганц зурагтай ч гэсэн 88px багана байрандаа үлдэнэ. */
        <div className="hidden lg:order-1 lg:block" />
      )}

      {/* Гол зураг — laptop дээр дизайны дагуу дотогшоо зайтай хүрээ */}
      <div className="relative order-1 aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-surface lg:order-2 lg:p-14">
        <ProductImage
          src={list[index]}
          alt={alt}
          className="h-full w-full lg:bg-surface lg:object-contain"
        />
        {overlay}
      </div>
    </div>
  );
}
