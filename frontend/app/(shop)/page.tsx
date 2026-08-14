"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdBanner } from "@/components/AdBanner";
import { ProductCard } from "@/components/ProductCard";
import { Button, Divider, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Ad, Category, Product, Store } from "@/lib/types";

const GUTTER = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 xl:px-10";

const ORDER_PREVIEW = 8;
const PAGE_SIZE = 20;

interface SectionData {
  items: Product[];
  total: number;
  page: number;
  pages: number;
}

const EMPTY_SECTION: SectionData = {
  items: [],
  total: 0,
  page: 1,
  pages: 1,
};

export default function HomePage() {
  const [store, setStore] = useState<Store | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orderData, setOrderData] = useState<SectionData>(EMPTY_SECTION);
  const [readyData, setReadyData] = useState<SectionData>(EMPTY_SECTION);

  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState<"order" | "ready" | null>(
    null,
  );
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

  const loadMore = async (type: "order" | "ready") => {
    const data = type === "order" ? orderData : readyData;

    const set = type === "order" ? setOrderData : setReadyData;

    setMoreLoading(type);

    try {
      const next = await fetchSection(type, data.page + 1);

      set({
        ...next,
        items: [...data.items, ...next.items],
      });
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
      {/* Advertisement */}
      {ads.length > 0 && !filtering && (
        <div className={`${GUTTER} pt-4 lg:pt-6`}>
          <AdBanner ads={ads} />
        </div>
      )}

      {/* Categories */}
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

      {/* Error */}
      {error && (
        <div className={`${GUTTER} pt-4`}>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* Loading */}
      {loading && <SectionSkeleton />}

      {/* Empty */}
      {nothing && <Empty>Энэ ангилалд одоогоор бараа алга.</Empty>}

      {/* Order products */}
      {!loading && orderData.items.length > 0 && (
        <Section
          id='order'
          title='Захиалгын бараа'
          hint='Одоо захиалж, ирэхэд мэдэгдэнэ'
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

      {/* Ready products */}
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

      {/* Features */}
      <FeatureHighlights />

      {/* Map */}
      {store && <MapSection />}

      {/* Store information */}
      {store && <TrustBlock store={store} />}
    </div>
  );
}

/* =========================================================
   CATEGORY CHIP
========================================================= */

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
      className={`
        h-10 shrink-0 cursor-pointer
        whitespace-nowrap rounded-[8px]
        border px-4 text-[14px]
        leading-tight transition-all
        ${
          active
            ? "border-primary bg-primary text-white shadow-sm shadow-primary/20"
            : "border-line bg-bg text-ink hover:border-primary-muted hover:bg-primary-soft hover:text-primary"
        }
      `}
    >
      {children}
    </button>
  );
}

/* =========================================================
   SKELETON
========================================================= */

function SectionSkeleton() {
  return (
    <div className='pt-8 lg:pt-12'>
      <div className={GUTTER}>
        <Skeleton className='h-7 w-44' />
        <Skeleton className='mt-2 h-4 w-64' />
      </div>

      <div
        className={`
          grid grid-cols-2 gap-4
          pt-5 sm:grid-cols-3 lg:grid-cols-4
          ${GUTTER}
        `}
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

/* =========================================================
   PRODUCT SECTION
========================================================= */

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

/* =========================================================
   FEATURE HIGHLIGHTS
========================================================= */
function FeatureHighlights() {
  return (
    <section className={`${GUTTER} mt-24 pt-10 sm:pt-12`}>
      <div className='grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2'>
        <FeatureItem icon='delivery' text='Хурдан шуурхай хүргэлт' />

        <FeatureItem icon='quality' text='Үйлдвэрийн үнэ, чанартай бараа' />

        <FeatureItem icon='clock' text='Захиалга 15-20 хоногт' />

        <FeatureItem
          icon='refund'
          text='Сар бүрийн 10, 20, 30-нд буцаалт хийнэ'
        />
      </div>
    </section>
  );
}

const FEATURE_ICONS = {
  delivery: (
    <>
      <path d='M2.5 6h9v8h-9z' />
      <path d='M11.5 9h3.2l2.8 2.8V14h-6z' />
      <circle cx='6' cy='15.3' r='1.6' />
      <circle cx='14.5' cy='15.3' r='1.6' />
    </>
  ),

  quality: (
    <>
      <path d='M10 2.5 12.4 7.4 17.8 8.2 13.9 12 14.8 17.4 10 14.8 5.2 17.4 6.1 12 2.2 8.2 7.6 7.4z' />
    </>
  ),

  clock: (
    <>
      <circle cx='10' cy='10' r='7.5' />
      <path d='M10 5.5V10l3 2' />
    </>
  ),

  refund: (
    <>
      <path d='M4 10a6 6 0 1 1 1.76 4.24' />
      <path d='M4 14.5V10h4.5' />
    </>
  ),
} as const;


function FeatureItem({
  icon,
  text,
}: {
  icon: keyof typeof FEATURE_ICONS;
  text: string;
}) {
  return (
    <div
      className='
        group flex min-h-[110px]
        items-center gap-5
        rounded-[16px]
        border border-line
        bg-surface
        p-5
        transition-all duration-200
        hover:border-primary/30
        hover:bg-primary-soft/30
        sm:min-h-[130px]
        sm:p-6
        lg:min-h-[150px]
        lg:gap-7
        lg:p-8
      '
    >
      <span
        className='
          flex h-16 w-16 shrink-0
          items-center justify-center
          rounded-[14px]
          bg-primary-soft
          text-primary
          transition-transform
          duration-200
          group-hover:scale-105
          sm:h-[72px] sm:w-[72px]
          lg:h-20 lg:w-20
        '
      >
        <svg
          width='32'
          height='32'
          viewBox='0 0 20 20'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.6'
          strokeLinecap='round'
          strokeLinejoin='round'
          className='
            h-8 w-8
            sm:h-9 sm:w-9
            lg:h-10 lg:w-10
          '
          aria-hidden='true'
        >
          {FEATURE_ICONS[icon]}
        </svg>
      </span>

      <p
        className='
          m-0
          text-[16px]
          font-semibold
          leading-[1.4]
          text-ink
          sm:text-[18px]
          lg:text-[21px]
        '
      >
        {text}
      </p>
    </div>
  );
}
/* =========================================================
   MAP
========================================================= */

function MapSection() {
  return (
    <section className={`${GUTTER} pt-10 sm:pt-12`}>
      <div className='mb-4 sm:mb-5'>
        <h2
          className='
            m-0 text-[20px]
            font-medium
            leading-[1.3]
            text-ink
            lg:text-[24px]
          '
        >
          Байршил
        </h2>
      </div>

      <div
        className='
          overflow-hidden
          rounded-[12px]
          border border-line
          shadow-sm
        '
      >
        <iframe
          src='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1442.7921895504498!2d106.81608800881027!3d47.868954615688175!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x5d96950010502423%3A0xfd23c0e1847d600c!2sItgel%20shop!5e1!3m2!1sen!2smn!4v1786613105055!5m2!1sen!2smn'
          width='600'
          height='450'
          style={{ border: 0 }}
          allowFullScreen
          loading='lazy'
          referrerPolicy='strict-origin-when-cross-origin'
          className='block h-[300px] w-full sm:h-[400px] lg:h-[450px]'
        />
      </div>
    </section>
  );
}

/* =========================================================
   STORE / TRUST BLOCK
========================================================= */

function TrustBlock({ store }: { store: Store }) {
  return (
    <section
      className='
        relative z-10
        mt-10
        sm:mt-12
      '
    >
      <div
        className='
          rounded-none
          border-x-0
          border-b-0
          border-t border-line
          bg-primary-soft/60
          p-5
          sm:p-6
          lg:p-8
        '
      >
        <div className={GUTTER}>
          <div
            className='
              flex flex-col gap-5
              sm:flex-row
              sm:items-start
              sm:gap-6
            '
          >
            {/* Logo */}
            <div className='shrink-0'>
              <Image
                src='/logo.webp'
                alt={store.storeName ?? "itgel"}
                width={48}
                height={48}
                priority
                className='
                  h-11 w-auto
                  sm:h-12
                '
              />
            </div>

            {/* Store information */}
            <div className='min-w-0 flex-1'>
              <div
                className='
                  grid gap-3.5
                  text-[14px]
                  sm:grid-cols-2
                  sm:gap-x-8
                  sm:gap-y-4
                '
              >
                <InfoRow label='Хаяг' value={store.address} />

                <InfoRow label='Ажлын цаг' value={store.workHours} />

                <InfoRow
                  label='Утас'
                  value={
                    <a
                      href={`tel:${store.phone.replace(/\D/g, "")}`}
                      className='
                        tnum text-primary
                        hover:underline
                      '
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
                        className='
                          break-all
                          text-primary
                          hover:underline
                        '
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

          <p
            className='
              m-0
              text-[12px]
              text-muted
              sm:text-[13px]
            '
          >
            © {new Date().getFullYear()} {store.storeName}
          </p>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   INFO ROW
========================================================= */

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='min-w-0'>
      <div
        className='
          text-[11px]
          font-medium
          uppercase
          tracking-wide
          text-muted
          sm:text-[12px]
        '
      >
        {label}
      </div>

      <div
        className='
          mt-0.5
          break-words
          leading-[1.5]
          text-ink
        '
      >
        {value}
      </div>
    </div>
  );
}
