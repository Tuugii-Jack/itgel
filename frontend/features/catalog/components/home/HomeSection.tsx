"use client";

import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui";
import type { SectionData } from "../../hooks/useHomeCatalog";
import { GUTTER } from "./constants";

export function HomeSection({
  id,
  title,
  hint,
  data,
  moreLoading,
  onMore,
  moreLabel,
  moreHref,
}: {
  id: string;
  title: string;
  hint: string;
  data: SectionData;
  moreLoading?: boolean;
  onMore?: () => void;
  moreLabel?: string;
  moreHref?: string;
}) {
  const hasMore = Boolean(moreHref) || data.items.length < data.total;

  return (
    <section id={id} className='scroll-mt-20 pt-8 lg:pt-12'>
      <div
        className={`
          flex items-end justify-between
          gap-4 ${GUTTER}
        `}
      >
        <div>
          <h2
            className='
              m-0 text-[20px]
              font-medium leading-[1.3]
              text-ink lg:text-[28px]
            '
          >
            {title}
          </h2>

          <p
            className='
              mt-1 mb-0
              text-[13px] text-ink-2
              lg:text-[15px]
            '
          >
            {hint}
          </p>
        </div>

        <span
          className='
            hidden shrink-0 whitespace-nowrap
            rounded-full bg-primary-soft
            px-3 py-1 text-[13px]
            font-medium text-primary
            sm:inline lg:text-[14px]
          '
        >
          {data.total} бараа
        </span>
      </div>

      <div
        className={`
          grid grid-cols-2 gap-4
          pt-5 sm:grid-cols-3 lg:grid-cols-4
          ${GUTTER}
        `}
      >
        {data.items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {hasMore && moreHref && (
        <div className={`flex justify-center pt-6 ${GUTTER}`}>
          <Link href={moreHref} className='no-underline'>
            <Button variant='outline'>{moreLabel ?? "Бүгдийг үзэх"}</Button>
          </Link>
        </div>
      )}

      {hasMore && !moreHref && onMore && (
        <div className={`flex justify-center pt-6 ${GUTTER}`}>
          <Button variant='outline' onClick={onMore} loading={moreLoading}>
            {moreLabel ?? `Цааш үзэх · ${data.total - data.items.length} бараа`}
          </Button>
        </div>
      )}
    </section>
  );
}
