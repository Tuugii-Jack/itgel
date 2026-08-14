"use client";

import { useState, type ReactNode } from "react";
import { ProductImage } from "@/components/ProductImage";

/**
 * Барааны галерей — гол зураг + доорх мини зургууд.
 * Desktop дээр өргөн нь хязгаартай тул хуудсыг давамгайлахгүй.
 */
export function ProductGallery({
  images,
  alt,
  overlay,
  className = "",
}: {
  images: (string | null | undefined)[];
  alt: string;
  overlay?: ReactNode;
  className?: string;
}) {
  const list = images.length > 0 ? images : [null];
  const [active, setActive] = useState(0);
  const index = Math.min(active, list.length - 1);
  const hasThumbs = list.length > 1;

  return (
    <div
      className={`mx-auto w-full max-w-[440px] min-w-0 lg:mx-0 lg:max-w-[480px] lg:justify-self-start ${className}`}
    >
      <div className='relative aspect-square w-full max-w-full overflow-hidden rounded-[12px] border border-line bg-surface'>
        <ProductImage
          src={list[index]}
          alt={alt}
          className='h-full w-full object-contain'
        />
        {overlay}
      </div>

      {hasThumbs && (
        <div
          className='mt-2.5 flex w-full max-w-full gap-2 overflow-x-auto pb-0.5 md:grid md:grid-cols-4 md:justify-start md:overflow-visible'
          style={{ direction: "rtl" }}
        >
          {list.map((src, i) => (
            <button
              key={i}
              type='button'
              onClick={() => setActive(i)}
              aria-label={`${alt} — зураг ${i + 1}`}
              aria-current={i === index}
              className={`aspect-square shrink-0 overflow-hidden rounded-[8px] border transition-colors
                h-16 w-16 md:h-auto md:w-full
                ${i === index ? "border-primary ring-1 ring-primary/30" : "border-line hover:border-primary-muted"}`}
              style={{ direction: "ltr" }}
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
