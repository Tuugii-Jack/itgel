"use client";

import { Skeleton } from "@/components/shadcn/skeleton";
import { Card, Divider } from "@/components/ui";

export function ProfilePageSkeleton() {
  return (
    <div className='screen pb-12' aria-busy='true' aria-label='Ачаалж байна'>
      <div className='px-4 pt-6 lg:hidden'>
        <Skeleton className='h-[26px] w-40' />
      </div>
      <div className='lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-10 lg:pt-8'>
        <ProfileSidebarSkeleton />
        <OrdersSkeleton />
      </div>
    </div>
  );
}

function ProfileSidebarSkeleton() {
  return (
    <div className='lg:sticky lg:top-8 lg:flex lg:flex-col lg:gap-4'>
      <div className='flex items-center gap-3 px-4 pt-5 lg:flex-col lg:items-stretch lg:gap-3 lg:rounded-[12px] lg:border lg:border-line lg:p-5 lg:pt-5'>
        <div className='flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:gap-3.5'>
          <Skeleton className='h-11 w-11 shrink-0 rounded-full lg:h-[52px] lg:w-[52px]' />
          <div className='min-w-0 flex-1'>
            <Skeleton className='h-[21px] w-32 lg:h-6' />
            <Skeleton className='mt-1 h-[17px] w-24' />
          </div>
        </div>
        <div className='hidden lg:block lg:h-px lg:bg-line' />
        <Skeleton className='h-9 w-14 shrink-0 rounded-[8px] lg:hidden' />
      </div>
      <div className='flex gap-2 px-4 pt-4 lg:flex-col lg:gap-1.5 lg:px-0 lg:pt-0'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={i}
            className='h-9 flex-1 rounded-[8px] lg:h-11 lg:flex-none lg:w-full'
          />
        ))}
      </div>
      <Skeleton className='hidden h-11 rounded-[8px] lg:block' />
    </div>
  );
}

export function OrdersSkeleton() {
  return (
    <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
      <div className='mb-3 flex items-baseline justify-between gap-4'>
        <Skeleton className='hidden h-[26px] w-24 lg:block' />
        <Skeleton className='h-[17px] w-48' />
      </div>
      <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <OrderCardSkeleton key={i} />
        ))}
      </div>
      <Skeleton className='mx-auto mt-4 h-[17px] w-64' />
    </div>
  );
}

function OrderCardSkeleton() {
  return (
    <Card className='h-full p-4 lg:p-5'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <Skeleton className='h-[21px] w-[7.25rem] lg:h-[27px]' />
          <Skeleton className='mt-1 h-[17px] w-40' />
        </div>
        <Skeleton className='h-6 w-[4.5rem] shrink-0 rounded-full' />
      </div>
      <div className='mt-3 grid grid-cols-3 gap-2'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className='flex flex-col gap-1.5'>
            <Skeleton className='h-1 w-full rounded-full' />
            <Skeleton className='h-3 w-12' />
          </div>
        ))}
      </div>
      <Divider className='my-3' />
      <div className='flex items-baseline justify-between gap-2'>
        <Skeleton className='h-[17px] w-16' />
        <Skeleton className='h-[17px] w-24' />
      </div>
      <div className='mt-1.5 flex items-baseline justify-between gap-2'>
        <Skeleton className='h-[17px] w-12' />
        <Skeleton className='h-[17px] w-20' />
      </div>
    </Card>
  );
}
