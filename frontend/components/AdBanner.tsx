"use client";

import Link from "next/link";
import { useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import type { Ad } from "@/lib/types";

/** Responsive баннер карусель — утас болон desktop дээр snap scroll. */
export function AdBanner({ ads, className = "" }: { ads: Ad[]; className?: string }) {
  const [index, setIndex] = useState(0);

  if (ads.length === 0) return null;

  return (
    <section className={`${className}`} aria-label="Зар сурталчилгаа">
      <div className="relative overflow-hidden rounded-[12px] border border-line bg-surface sm:rounded-[16px]">
        <div
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / el.clientWidth));
          }}
        >
          {ads.map((ad) => (
            <Slide key={ad.id} ad={ad} />
          ))}
        </div>

        {ads.length > 1 && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {ads.map((ad, i) => (
                <span
                  key={ad.id}
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${
                    i === index ? "bg-white shadow-sm" : "bg-white/50"
                  }`}
                />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-end px-3">
              <span className="tnum rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-white">
                {index + 1}/{ads.length}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Slide({ ad }: { ad: Ad }) {
  const image = (
    <ProductImage
      src={ad.imageUrl}
      alt={ad.title || "Зар"}
      className="aspect-[2/1] w-full shrink-0 snap-center sm:aspect-[2.4/1] lg:aspect-[3/1]"
    />
  );

  if (!ad.linkUrl) {
    return <div className="w-full shrink-0 snap-center">{image}</div>;
  }

  const external = ad.linkUrl.startsWith("http");
  if (external) {
    return (
      <a
        href={ad.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full shrink-0 snap-center no-underline"
      >
        {image}
      </a>
    );
  }

  return (
    <Link href={ad.linkUrl} className="block w-full shrink-0 snap-center no-underline">
      {image}
    </Link>
  );
}
