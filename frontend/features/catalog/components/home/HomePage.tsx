"use client";

import { AdBanner } from "@/components/AdBanner";
import { Empty, ErrorNote } from "@/components/ui";
import { ORDER_PREVIEW, useHomeCatalog } from "../../hooks/useHomeCatalog";
import { FeatureHighlights } from "./FeatureHighlights";
import { HomeSection } from "./HomeSection";
import { HomePageSkeleton, ProductSectionSkeleton } from "./HomeSkeletons";
import { MapSection } from "./MapSection";
import { TrustBlock } from "./TrustBlock";
import { GUTTER } from "./constants";

export function HomePage() {
  const {
    store,
    ads,
    categories,
    orderData,
    readyData,
    category,
    setCategory,
    booting,
    loading,
    moreLoading,
    error,
    loadMore,
    nothing,
    filtering,
  } = useHomeCatalog();

  if (booting) {
    return <HomePageSkeleton />;
  }

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
      {loading && (
        <>
          <ProductSectionSkeleton />
          <ProductSectionSkeleton />
        </>
      )}

      {/* Empty */}
      {nothing && <Empty>Энэ ангилалд одоогоор бараа алга.</Empty>}

      {/* Order products */}
      {!loading && orderData.items.length > 0 && (
        <HomeSection
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
        <HomeSection
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
