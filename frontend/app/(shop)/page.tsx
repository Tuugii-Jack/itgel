"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdBanner } from "@/components/AdBanner";
import { ProductCard } from "@/components/ProductCard";
import { Button, Divider, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import type { Ad, Category, Product, Store } from "@/lib/types";

const GUTTER = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 xl:px-10";

/** Нүүр дээр захиалгын барааны эхний хязгаар — илүү бол «Бүгдийг үзэх». */
const ORDER_PREVIEW = 8;
const PAGE_SIZE = 20;

/** Нэг төрлийн барааны жагсаалт + хуудаслалт. */
interface SectionData {
  items: Product[];
  total: number;
  page: number;
  pages: number;
}

const EMPTY_SECTION: SectionData = { items: [], total: 0, page: 1, pages: 1 };

export default function HomePage() {
  const cart = useCart();
  const [store, setStore] = useState<Store | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orderData, setOrderData] = useState<SectionData>(EMPTY_SECTION);
  const [readyData, setReadyData] = useState<SectionData>(EMPTY_SECTION);
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState<"order" | "ready" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.store(), api.categories(), api.ads()])
      .then(([s, c, a]) => {
        setStore(s);
        setCategories(c);
        setAds(a);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  const fetchSection = useCallback(
    async (type: "order" | "ready", page: number, pageSize = PAGE_SIZE) => {
      const result = await api.products({
        type,
        category: category ?? undefined,
        page,
        pageSize,
        sort: type === "order" ? "closing" : undefined,
      });
      return {
        items: result.data,
        total: result.meta?.total ?? result.data.length,
        page: result.meta?.page ?? page,
        pages: result.meta?.pages ?? 1,
      };
    },
    [category],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [order, ready] = await Promise.all([
        fetchSection("order", 1, ORDER_PREVIEW),
        fetchSection("ready", 1),
      ]);
      setOrderData(order);
      setReadyData(ready);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [fetchSection]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  /** «Цааш үзэх» — дараагийн хуудсыг одоогийнх дээр нэмнэ. */
  const loadMore = async (type: "order" | "ready") => {
    const data = type === "order" ? orderData : readyData;
    const set = type === "order" ? setOrderData : setReadyData;
    setMoreLoading(type);
    try {
      const next = await fetchSection(type, data.page + 1);
      set({ ...next, items: [...data.items, ...next.items] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Бараа ачаалж чадсангүй.");
    } finally {
      setMoreLoading(null);
    }
  };

  const nothing =
    !loading && orderData.items.length === 0 && readyData.items.length === 0;
  const filtering = category !== null;

  return (
    <div className='page'>
      {ads.length > 0 && !filtering && (
        <div className={`${GUTTER} pt-4 lg:pt-6`}>
          <AdBanner ads={ads} />
        </div>
      )}

      {/* Category chips — soft blue active state */}
      <div
        className={`no-scrollbar flex gap-2 overflow-x-auto ${GUTTER} pt-4 lg:pt-6`}
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

      {loading && <SectionSkeleton />}

      {nothing && (
        <Empty>Энэ ангилалд одоогоор бараа алга.</Empty>
      )}

      {!loading && orderData.items.length > 0 && (
        <Section
          id='order'
          title='Захиалгын бараа'
          hint='Одоо захиалж, 2-3 долоо хоногийн дараа авна'
          data={orderData}
          moreHref={
            orderData.total > ORDER_PREVIEW
              ? category
                ? `/order?category=${encodeURIComponent(category)}`
                : "/order"
              : undefined
          }
          moreLabel='Бүгдийг үзэх'
        />
      )}

      {!loading && readyData.items.length > 0 && (
        <Section
          id='ready'
          title='Бэлэн бараа'
          hint='Агуулахад байгаа, шууд авах боломжтой'
          data={readyData}
          moreLoading={moreLoading === "ready"}
          onMore={() => loadMore("ready")}
        />
      )}

      {store && <MapSection />}

      {store && <TrustBlock store={store} />}

      {cart.count > 0 && (
        <div
          className={`fixed inset-x-0 bottom-4 z-20 flex justify-center px-4
            md:inset-x-auto md:right-6 md:bottom-6 md:justify-end md:px-0`}
        >
          <Link href='/cart' className='no-underline'>
            <Button
              variant='outline'
              size='sm'
              className='bg-bg/90 backdrop-blur-sm opacity-60 transition-opacity duration-200
                hover:opacity-100 active:opacity-100 focus:opacity-100'
            >
              Сагс үзэх · {cart.count} бараа
            </Button>
          </Link>
        </div>
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

/** Ачаалж буй үед барааны картын хэлбэртэй skeleton — хоосон дэлгэцээс дээр. */
function SectionSkeleton() {
  return (
    <div className='pt-8 lg:pt-12'>
      <div className={GUTTER}>
        <Skeleton className='h-7 w-44' />
        <Skeleton className='mt-2 h-4 w-64' />
      </div>
      <div
        className={`grid grid-cols-2 gap-4 pt-5 sm:grid-cols-3 lg:grid-cols-4 ${GUTTER}`}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className='flex flex-col gap-2.5'>
            <Skeleton className='aspect-square w-full rounded-[12px]' />
            <Skeleton className='h-4 w-4/5' />
            <Skeleton className='h-5 w-2/5' />
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
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
  /** Өгвөл товч энэ хуудас руу шилжинэ (нүүрээс «Бүгдийг үзэх»). */
  moreHref?: string;
}) {
  const hasMore = Boolean(moreHref) || data.items.length < data.total;

  return (
    <section id={id} className='scroll-mt-20 pt-8 lg:pt-12'>
      <div className={`flex items-end justify-between gap-4 ${GUTTER}`}>
        <div>
          <h2 className='m-0 text-[20px] font-medium leading-[1.3] text-ink lg:text-[28px]'>
            {title}
          </h2>
          <p className='mt-1 mb-0 text-[13px] text-ink-2 lg:text-[15px]'>
            {hint}
          </p>
        </div>
        <span className='hidden shrink-0 whitespace-nowrap rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary sm:inline lg:text-[14px]'>
          {data.total} бараа
        </span>
      </div>

      {/* 4 багана дээр карт ~270px — өргөн дэлгэцэд шахуу харагдахгүй. */}
      <div
        className={`grid grid-cols-2 gap-4 pt-5 sm:grid-cols-3 lg:grid-cols-4 ${GUTTER}`}
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
            {moreLabel ??
              `Цааш үзэх · ${data.total - data.items.length} бараа`}
          </Button>
        </div>
      )}
    </section>
  );
}

function MapSection() {
  return (
    <section className={`${GUTTER} pt-10 sm:pt-12`}>
      <div className='mb-4 sm:mb-5'>
        <h2 className='m-0 text-[20px] font-medium leading-[1.3] text-ink lg:text-[24px]'>
          Байршил
        </h2>
      
      </div>

      <div className='overflow-hidden rounded-[12px] border border-line shadow-sm'>
        <iframe
          src='https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1213.2483390526872!2d106.81671469298601!3d47.868546277165414!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x5d969586de853db9%3A0xa0feada2340ad382!2z0JTTqdC806nQsyDTqNGA0LPTqdOpIEFwYXJ0bWVudA!5e1!3m2!1sen!2smn!4v1786297975462!5m2!1sen!2smn'
          width='600'
          height='450'
          style={{ border: 0 }}
          allowFullScreen
          loading='lazy'
          referrerPolicy='strict-origin-when-cross-origin'
          className='h-[260px] w-full sm:h-[320px] lg:h-[380px]'
          title='Дэлгүүрийн байршил'
        />
      </div>
    </section>
  );
}

function TrustBlock({ store }: { store: Store }) {
  return (
    <section className='relative z-10 mt-10 sm:mt-12'>
      <div className='rounded-none border-x-0 border-b-0 border-t border-line bg-primary-soft/60 p-5 sm:p-6 lg:p-8'>
        <div className={`${GUTTER}`}>
          <div className='flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6'>
            {/* Logo */}
            <div className='shrink-0'>
              <Image
                src='/logo.webp'
                alt={store?.storeName ?? "itgel"}
                width={48}
                height={48}
                priority
                className='h-11 w-auto sm:h-12'
              />
            </div>

            {/* Store information */}
            <div className='min-w-0 flex-1'>
              

              <div className='grid gap-3.5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-4 text-[14px]'>
                <InfoRow label='Хаяг' value={store.address} />
                <InfoRow label='Ажлын цаг' value={store.workHours} />

                <InfoRow
                  label='Утас'
                  value={
                    <a
                      href={`tel:${store.phone.replace(/\D/g, "")}`}
                      className='tnum text-primary hover:underline'
                    >
                      {store.phone}
                    </a>
                  }
                />

                {store.facebookUrl && (
                  <InfoRow
                    label='Facebook'
                    value={
                      <a
                        href={store.facebookUrl}
                        target='_blank'
                        rel='noreferrer'
                        className='break-all text-primary hover:underline'
                      >
                        {store.facebookUrl.replace(/^https?:\/\//, "")}
                      </a>
                    }
                  />
                )}
              </div>
            </div>
          </div>

          <Divider className='my-5 sm:my-6' />

          <p className='m-0 text-[12px] text-muted sm:text-[13px]'>
            © {new Date().getFullYear()} {store.storeName}
          </p>
        </div>
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='min-w-0'>
      <div className='text-[11px] font-medium uppercase tracking-wide text-muted sm:text-[12px]'>
        {label}
      </div>
      <div className='mt-0.5 break-words leading-[1.5] text-ink'>{value}</div>
    </div>
  );
}
