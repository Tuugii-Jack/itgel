"use client";

import { Skeleton } from "@/components/shadcn/skeleton";
import { Divider } from "@/components/ui";
import { GUTTER } from "./constants";

const CHIP_SKELETON_WIDTHS = [
  "w-16",
  "w-[9.5rem]",
  "w-20",
  "w-24",
  "w-[7.5rem]",
  "w-28",
  "w-[5.5rem]",
] as const;

export function HomePageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Ачаалж байна">
      <div className={`${GUTTER} pt-4 lg:pt-6`}>
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface sm:rounded-[16px]">
          <Skeleton className="aspect-[2/1] w-full rounded-none sm:aspect-[2.4/1] lg:aspect-[3/1]" />
        </div>
      </div>

      <div className={`flex gap-2 overflow-hidden ${GUTTER} pt-4 lg:pt-6`}>
        {CHIP_SKELETON_WIDTHS.map((width, i) => (
          <Skeleton key={i} className={`h-10 shrink-0 rounded-[8px] ${width}`} />
        ))}
      </div>

      <ProductSectionSkeleton titleWidth="w-[9.5rem]" hintWidth="w-64" />
      <ProductSectionSkeleton titleWidth="w-[7.5rem]" hintWidth="w-72" />

      <section className={`${GUTTER} mt-24 pt-10 sm:pt-12`}>
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-[110px] items-center gap-5 rounded-[16px] border border-line bg-surface p-5 sm:min-h-[130px] sm:p-6 lg:min-h-[150px] lg:gap-7 lg:p-8"
            >
              <Skeleton className="h-16 w-16 shrink-0 rounded-[14px] sm:h-[72px] sm:w-[72px] lg:h-20 lg:w-20" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-[22px] w-4/5 sm:h-[25px] lg:h-[29px]" />
                <Skeleton className="h-[22px] w-2/5 sm:hidden" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={`${GUTTER} pt-10 sm:pt-12`}>
        <Skeleton className="mb-4 h-[26px] w-24 lg:mb-5 lg:h-[31px]" />
        <div className="overflow-hidden rounded-[12px] border border-line shadow-sm">
          <Skeleton className="block h-[300px] w-full rounded-none sm:h-[400px] lg:h-[450px]" />
        </div>
      </section>

      <section className="relative z-10 mt-10 sm:mt-12">
        <div className="rounded-none border-x-0 border-b-0 border-t border-line bg-primary-soft/60 p-5 sm:p-6 lg:p-8">
          <div className={GUTTER}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
              <Skeleton className="h-11 w-11 shrink-0 rounded-[8px] sm:h-12 sm:w-12" />
              <div className="grid min-w-0 flex-1 gap-3.5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <Skeleton className="h-[13px] w-14 sm:h-3.5" />
                    <Skeleton className="h-[21px] w-3/4" />
                  </div>
                ))}
              </div>
            </div>
            <Divider className="my-5 sm:my-6" />
            <Skeleton className="h-3 w-40 sm:h-[17px]" />
          </div>
        </div>
      </section>
    </div>
  );
}

export function ProductSectionSkeleton({
  titleWidth = "w-44",
  hintWidth = "w-64",
}: {
  titleWidth?: string;
  hintWidth?: string;
}) {
  return (
    <section className="scroll-mt-20 pt-8 lg:pt-12">
      <div className={`flex items-end justify-between gap-4 ${GUTTER}`}>
        <div>
          <Skeleton className={`h-[26px] ${titleWidth} lg:h-9`} />
          <Skeleton className={`mt-1 h-[17px] ${hintWidth} lg:h-5`} />
        </div>
        <Skeleton className="hidden h-7 w-[4.75rem] shrink-0 rounded-full sm:block" />
      </div>

      <div
        className={`grid grid-cols-2 gap-4 pt-5 sm:grid-cols-3 lg:grid-cols-4 ${GUTTER}`}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-bg">
      <div className="relative aspect-square border-b border-line bg-surface">
        <Skeleton className="size-full rounded-none" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Skeleton className="h-[21px] w-[90%]" />
        <Skeleton className="h-[21px] w-3/5" />
        <Skeleton className="h-[27px] w-24" />
        <div className="mt-auto pt-1">
          <Skeleton className="h-11 w-full rounded-[8px]" />
        </div>
      </div>
    </div>
  );
}
