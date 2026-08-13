"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import type { Ad } from "@/lib/types";

const AUTOPLAY_MS = 5000;

/** Responsive баннер карусель — swipe + 5 секунд тутмын autoplay. */
export function AdBanner({
  ads,
  className = "",
}: {
  ads: Ad[];
  className?: string;
}) {
  const adsKey = ads.map((ad) => ad.id).join("-");

  return <AdBannerCarousel key={adsKey} ads={ads} className={className} />;
}

function AdBannerCarousel({
  ads,
  className = "",
}: {
  ads: Ad[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const isUserScrolling = useRef(false);

  const userScrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Autoplay
   */
  useEffect(() => {
    if (ads.length <= 1) return;

    const timer = setInterval(() => {
      const el = scrollerRef.current;

      if (!el || isUserScrolling.current) return;

      const currentIndex = Math.round(el.scrollLeft / el.clientWidth);

      const nextIndex = (currentIndex + 1) % ads.length;

      el.scrollTo({
        left: nextIndex * el.clientWidth,
        behavior: "smooth",
      });
    }, AUTOPLAY_MS);

    return () => {
      clearInterval(timer);
    };
  }, [ads.length]);

  /*
   * Cleanup user scroll timeout
   */
  useEffect(() => {
    return () => {
      if (userScrollTimeout.current) {
        clearTimeout(userScrollTimeout.current);
      }
    };
  }, []);

  if (ads.length === 0) {
    return null;
  }

  return (
    <section className={className} aria-label='Зар сурталчилгаа'>
      <div className='relative overflow-hidden rounded-[12px] border border-line bg-surface sm:rounded-[16px]'>
        {/* Carousel */}
        <div
          ref={scrollerRef}
          className='no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth'
          onScroll={(e) => {
            const el = e.currentTarget;

            if (el.clientWidth === 0) return;

            const newIndex = Math.round(el.scrollLeft / el.clientWidth);

            setIndex(Math.max(0, Math.min(newIndex, ads.length - 1)));

            /*
             * User manually swiped/scrolled.
             * Pause autoplay temporarily.
             */
            isUserScrolling.current = true;

            if (userScrollTimeout.current) {
              clearTimeout(userScrollTimeout.current);
            }

            userScrollTimeout.current = setTimeout(() => {
              isUserScrolling.current = false;
            }, AUTOPLAY_MS);
          }}
        >
          {ads.map((ad) => (
            <Slide key={ad.id} ad={ad} />
          ))}
        </div>

        {/* Controls */}
        {ads.length > 1 && (
          <>
            {/* Dots */}
            <div className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5'>
              {ads.map((ad, i) => (
                <span
                  key={ad.id}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-4 bg-white shadow-sm" : "w-1.5 bg-white/50"
                  }`}
                />
              ))}
            </div>

            {/* Counter */}
            <div className='pointer-events-none absolute inset-x-0 top-3 flex justify-end px-3'>
              <span className='tnum rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm'>
                {index + 1}/{ads.length}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* =========================================================
   SLIDE
========================================================= */

function Slide({ ad }: { ad: Ad }) {
  const image = (
    <ProductImage
      src={ad.imageUrl}
      alt={ad.title || "Зар"}
      className='aspect-[2/1] w-full shrink-0 snap-center sm:aspect-[2.4/1] lg:aspect-[3/1]'
    />
  );

  /*
   * No link
   */
  if (!ad.linkUrl) {
    return <div className='w-full shrink-0 snap-center'>{image}</div>;
  }

  /*
   * External link
   */
  const external = ad.linkUrl.startsWith("http");

  if (external) {
    return (
      <a
        href={ad.linkUrl}
        target='_blank'
        rel='noopener noreferrer'
        className='block w-full shrink-0 snap-center no-underline'
      >
        {image}
      </a>
    );
  }

  /*
   * Internal link
   */
  return (
    <Link
      href={ad.linkUrl}
      className='block w-full shrink-0 snap-center no-underline'
    >
      {image}
    </Link>
  );
}
