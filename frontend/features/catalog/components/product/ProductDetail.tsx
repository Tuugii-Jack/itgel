"use client";

import Link from "next/link";
import { use } from "react";
import { ProductGallery } from "@/components/ProductGallery";
import { ShopPrice } from "@/components/ShopPrice";
import {
  Button,
  Card,
  ChoiceGroup,
  ErrorNote,
  Skeleton,
} from "@/components/ui";
import { money } from "@/lib/format";
import { optionValueSoldOut, priceLabel, selectedSkuStock } from "@/lib/options";
import type { Product } from "@/lib/types";
import { useProductDetail } from "../../hooks/useProductDetail";
import { FACT_ICONS, KeyFacts } from "./KeyFacts";
import { ProductDescription } from "./ProductDescription";
import { Stepper } from "./Stepper";

export function ProductDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    product,
    store,
    selections,
    setSelections,
    qty,
    setQty,
    error,
    notice,
    setNotice,
    closeLabel,
    addToCart,
    isOrder,
    soldOut,
    closed,
    blocked,
    options,
    missingOpt,
    unitPrice,
    cannotBuy,
    qtyMax,
    total,
  } = useProductDetail(id);

  if (error) {
    return (
      <div className='p-4'>
        <ErrorNote>{error}</ErrorNote>
        <Link href='/' className='no-underline'>
          <Button className='mt-4' variant='outline'>
            Нүүр хуудас
          </Button>
        </Link>
      </div>
    );
  }

  if (!product || !store) {
    return (
      <div className='page pb-28 lg:pb-12'>
        <div className='mx-auto grid w-full max-w-[1100px] gap-8 px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start lg:gap-10 lg:px-10 lg:pt-8'>
          <Skeleton className='aspect-square w-full max-w-[440px] rounded-[12px]' />
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-5 w-28' />
            <Skeleton className='h-7 w-3/4' />
            <Skeleton className='h-9 w-40' />
            <Skeleton className='mt-3 h-24 w-full rounded-[12px]' />
            <Skeleton className='h-11 w-full rounded-[8px]' />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='page pb-28 lg:pb-16'>
      <div className='mx-auto w-full max-w-[1100px] px-4 sm:px-6 lg:px-10'>
        <nav className='hidden items-center gap-2 pt-6 text-[13px] text-muted lg:flex'>
          <Link href='/' className='text-muted no-underline hover:text-ink-2'>
            Нүүр
          </Link>
          <span>/</span>
          <span>
            {product.category?.name ??
              (isOrder ? "Захиалгын бараа" : "Бэлэн бараа")}
          </span>
          <span>/</span>
          <span className='truncate text-ink-2'>{product.name}</span>
        </nav>

        <div className='grid gap-6 pt-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start lg:gap-10 lg:pt-6'>
          <div className='min-w-0'>
            <ProductGallery
              images={product.images}
              alt={product.name}
              overlay={
                blocked ? null : (
                  <GalleryChip
                    product={product}
                    closeLabel={closeLabel}
                    soldOut={soldOut}
                  />
                )
              }
            />
          </div>

          <div className='flex min-w-0 flex-col gap-5 lg:gap-6'>
            <div className='flex flex-col gap-2'>
              {/* <Badge tone={isOrder ? "neutral" : "ok"} className='self-start'>
                {isOrder ? "Захиалгын бараа" : "Бэлэн бараа"}
              </Badge> */}
              <h1 className='m-0 text-[22px] font-medium leading-[1.3] tracking-[-0.01em] lg:text-[26px]'>
                {product.name}
              </h1>
              <div className='tnum text-[26px] font-medium leading-none lg:text-[28px]'>
                <ShopPrice noteClassName='text-[18px] font-medium text-ink-2 lg:text-[20px]'>
                  {missingOpt
                    ? priceLabel(product.price, product.priceMax)
                    : money(unitPrice)}
                </ShopPrice>
              </div>
              <div className='text-[13px] leading-[1.45] text-muted lg:text-[14px]'>
                Бараа ирсний дараа карго үнэ бодогдоно.
              </div>
            </div>

            {product.description && (
              <ProductDescription
                description={product.description}
                className='mt-0 lg:mt-6'
              />
            )}
            {blocked && (
              <div
                className={`rounded-[12px] border px-4 py-3 ${closed ? "border-warn bg-warn-bg" : "border-danger bg-danger-bg"}`}
              >
                <div
                  className={`text-[15px] font-medium ${closed ? "text-warn" : "text-danger"}`}
                >
                  {closed
                    ? "Энэ барааны захиалга хаагдсан"
                    : "Энэ бараа дууссан"}
                </div>
                <p className='mt-1 mb-0 text-[13px] text-ink-2'>
                  {closed
                    ? "Дараагийн багцад орохоор нээгдэх үед сайт дээр дахин гарна."
                    : "Дахин нөхөгдөх үед сайт дээр дахин гарна."}
                </p>
              </div>
            )}

            {/* Product description is shown beneath the gallery to avoid duplicates */}

            <KeyFacts
              product={product}
              closeLabel={closeLabel}
              soldOut={soldOut}
              closed={closed}
            />

            {!closed &&
              options.map((opt) => {
                const selected = selections[opt.name] ?? null;
                return (
                  <div key={opt.name}>
                    <div className='mb-2 text-[14px] text-ink-2'>
                      {opt.name}
                      {selected && <span className='tnum'> · {selected}</span>}
                    </div>
                    <ChoiceGroup
                      columns={
                        opt.values.length > 4
                          ? 4
                          : Math.max(2, opt.values.length)
                      }
                      options={opt.values.map((v) => {
                        const gone =
                          !isOrder &&
                          optionValueSoldOut(product.skuStocks, selections, opt.name, v);
                        return {
                          value: v,
                          label: v,
                          disabled: gone,
                          note: gone ? "Дууссан" : undefined,
                        };
                      })}
                      value={selected}
                      onChange={(v) => {
                        const next = { ...selections, [opt.name]: v };
                        setSelections(next);
                        setNotice(null);
                        const cap = selectedSkuStock(product.skuStocks, next, options);
                        if (cap != null && qty > cap) setQty(Math.max(1, cap));
                      }}
                    />
                  </div>
                );
              })}

            {!cannotBuy && (
              <div className='lg:hidden'>
                <div className='mb-2.5 text-[15px] font-medium'>Тоо ширхэг</div>
                <div className='flex items-center gap-3'>
                  <Stepper
                    qty={qty}
                    max={qtyMax || 1}
                    onChange={setQty}
                  />
                  <span className='tnum text-[15px] text-ink-2'>
                    = {money(total)}
                  </span>
                </div>
              </div>
            )}

            {notice && <ErrorNote>{notice}</ErrorNote>}
            {cannotBuy && !isOrder && !closed && (
              <ErrorNote>
                Энэ бэлэн бараа одоо авах боломжгүй. Үлдэгдэл дууссан эсвэл өөр захиалгад түр нөөцлөгдсөн.
              </ErrorNote>
            )}

            <div className='hidden lg:flex lg:flex-col lg:gap-2'>
              {cannotBuy ? (
                <Link href='/' className='no-underline'>
                  <Button full size='bar' variant='outline'>
                    Бусад бараа үзэх
                  </Button>
                </Link>
              ) : (
                <>
                  <div className='flex items-center gap-4'>
                    <Stepper
                      qty={qty}
                      max={qtyMax || 1}
                      onChange={setQty}
                      size='lg'
                    />
                    <div className='min-w-0 flex-1'>
                      <div className='text-[13px] text-muted'>Нийт</div>
                      <div className='tnum text-[18px] font-medium'>
                        {money(total)}
                      </div>
                    </div>
                    <Button size='bar' onClick={addToCart} className='px-8'>
                      Сагсанд хийх
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {product.sizeChart.length > 0 && (
          <div className='mt-10 grid gap-8 border-t border-line pt-8 lg:mt-12 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-10 lg:pt-10'>
            <div>
              <div className='mb-2 text-[15px] font-medium lg:mb-3 lg:text-[17px]'>
                Хэмжээсийн хүснэгт
              </div>
              <Card className='overflow-hidden'>
                <table className='w-full border-collapse text-[13px]'>
                  <thead>
                    <tr className='bg-surface text-ink-2'>
                      <th className='px-3 py-2.5 text-left font-normal'>
                        Хэмжээ
                      </th>
                      <th className='px-3 py-2.5 text-left font-normal'>
                        Өндөр, см
                      </th>
                      <th className='px-3 py-2.5 text-left font-normal'>
                        Цээж, см
                      </th>
                    </tr>
                  </thead>
                  <tbody className='text-[14px]'>
                    {product.sizeChart.map((row, i) => (
                      <tr
                        key={`${row.size}-${i}`}
                        className='border-t border-line'
                      >
                        <td className='px-3 py-2.5'>{row.size}</td>
                        <td className='tnum px-3 py-2.5 text-ink-2'>
                          {row.heightRange}
                        </td>
                        <td className='tnum px-3 py-2.5 text-ink-2'>
                          {row.chestCm}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        )}
      </div>

      <div
        className='fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[560px] items-center gap-3 border-t border-line bg-bg p-4
        shadow-[0_-8px_24px_rgba(20,20,25,0.06)]
        pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden'
      >
        {cannotBuy ? (
          <Link href='/' className='w-full no-underline'>
            <Button full size='lg' variant='outline'>
              Бусад бараа үзэх
            </Button>
          </Link>
        ) : (
          <>
            <div className='min-w-0 flex-1'>
              <div className='text-[12px] text-muted'>Нийт төлөх</div>
              <div className='tnum text-[18px] font-semibold'>
                {money(total)}
              </div>
            </div>
            <Button size='lg' onClick={addToCart} className='min-w-[160px]'>
              Сагсанд хийх
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Гол зурган дээрх шошго — дизайнд зүүн доод буланд «Захиалга хаагдах …».
 * Бэлэн бараанд хаагдах хугацаа байхгүй тул үлдэгдлийг харуулна.
 */
function GalleryChip({
  product,
  closeLabel,
  soldOut,
}: {
  product: Product;
  closeLabel: string;
  soldOut: boolean;
}) {
  const isOrder = product.type === "order";
  if (isOrder && !closeLabel) return null;
  if (!isOrder && soldOut) return null;

  return (
    <span
      className={`absolute bottom-3 left-3 inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-bg/95 px-2.5 backdrop-blur-sm lg:bottom-4 lg:left-4 lg:px-3
        ${isOrder ? "text-warn" : "text-ok"}`}
    >
      <svg
        width='14'
        height='14'
        viewBox='0 0 14 14'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden
      >
        {isOrder ? FACT_ICONS.clock : FACT_ICONS.box}
      </svg>
      <span className='tnum text-[13px]'>
        {isOrder
          ? `Захиалга хаагдах ${closeLabel}`
          : `Үлдэгдэл ${product.stock} ширхэг`}
      </span>
    </span>
  );
}
