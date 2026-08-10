"use client";

import { useState } from "react";
import { ProductImage } from "@/components/ProductImage";

/**
 * Барааны олон зурагтай галерей.
 * Эхний зураг үндсэн (том) зураг байдаг ба үлдсэн зургууд доор нь жижгээр жагсдаг.
 * Жижиг зураг дээр дарахад тэр нь дээш, том зураг болж гарч ирнэ.
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

  // Одоо гол зурган дээр харагдаж буйгаас бусад нь жижиг мөрөнд орно.
  const thumbnails = list
    .map((src, i) => ({ src, i }))
    .filter(({ i }) => i !== index);

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {/* Гол зураг — эхний (эсвэл сонгосон) зураг том харагдана */}
      <div className='relative aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-surface'>
        <ProductImage src={list[index]} alt={alt} className='h-full w-full' />
      </div>

      {/* Үлдсэн зургууд — доор нь жижгээр */}
      {thumbnails.length > 0 && (
        <div className='no-scrollbar flex gap-2 overflow-x-auto'>
          {thumbnails.map(({ src, i }) => (
            <button
              key={i}
              type='button'
              onClick={() => setActive(i)}
              aria-label={`${alt} — зураг ${i + 1}`}
              className='h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border border-line transition-colors hover:border-primary-muted'
            >
              <ProductImage
                src={src}
                alt={`${alt} ${i + 1}`}
                className='h-full w-full'
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
