"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ProductCard } from "@/components/ProductCard";
import { Button, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Category, Product } from "@/lib/types";

const GUTTER = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 xl:px-10";
const PAGE_SIZE = 20;

/** Захиалгын барааны бүх жагсаалт — нүүрээс «Бүгдийг үзэх». */
export default function OrderProductsPage() {
  return (
    <Suspense fallback={null}>
      <OrderProductsContent />
    </Suspense>
  );
}

function OrderProductsContent() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get("category");
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .categories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.products({
        type: "order",
        category: category ?? undefined,
        page: 1,
        pageSize: PAGE_SIZE,
        sort: "closing",
      });
      setItems(result.data);
      setTotal(result.meta?.total ?? result.data.length);
      setPage(result.meta?.page ?? 1);
      setPages(result.meta?.pages ?? 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const result = await api.products({
        type: "order",
        category: category ?? undefined,
        page: page + 1,
        pageSize: PAGE_SIZE,
        sort: "closing",
      });
      setItems((prev) => [...prev, ...result.data]);
      setPage(result.meta?.page ?? page + 1);
      setPages(result.meta?.pages ?? pages);
      setTotal(result.meta?.total ?? total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setMoreLoading(false);
    }
  };

  return (
    <div className='page pb-24'>
      <div className={`${GUTTER} pt-6 lg:pt-8`}>
        <h1 className='m-0 text-[22px] font-medium lg:text-[28px]'>
          Захиалгын бараа
        </h1>
        <p className='mt-1 mb-0 text-[13px] text-ink-2 lg:text-[15px]'>
          Одоо захиалж, ирэхэд мэдэгдэнэ
        </p>
      </div>

      <div
        className={`no-scrollbar flex gap-2 overflow-x-auto ${GUTTER} pt-4 lg:pt-5`}
      >
        <Chip active={category === null} onClick={() => setCategory(null)}>
          Бүгд
        </Chip>
        {categories.map((c) => (
          <Chip
            key={c.id}
            active={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.name}
          </Chip>
        ))}
      </div>

      {error && (
        <div className={`${GUTTER} pt-4`}>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && (
        <div
          className={`grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-4 ${GUTTER}`}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className='flex flex-col gap-2.5'>
              <Skeleton className='aspect-square w-full rounded-[12px]' />
              <Skeleton className='h-4 w-4/5' />
              <Skeleton className='h-5 w-2/5' />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <Empty>Энэ ангилалд одоогоор бараа алга.</Empty>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className={`${GUTTER} flex justify-end pt-4`}>
            <span className='rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary'>
              {total} бараа
            </span>
          </div>
          <div
            className={`grid grid-cols-2 gap-4 pt-4 sm:grid-cols-3 lg:grid-cols-4 ${GUTTER}`}
          >
            {items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {page < pages && (
            <div className={`flex justify-center pt-6 ${GUTTER}`}>
              <Button
                variant='outline'
                onClick={loadMore}
                loading={moreLoading}
              >
                Цааш үзэх · {total - items.length} бараа
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-[8px] border px-4 text-[14px] leading-tight transition-all
        ${
          active
            ? "border-primary bg-primary text-white shadow-sm shadow-primary/20"
            : "border-line bg-bg text-ink hover:border-primary-muted hover:bg-primary-soft hover:text-primary"
        }`}
    >
      {children}
    </button>
  );
}
