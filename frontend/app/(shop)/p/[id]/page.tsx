"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useCountdown } from "@/components/ProductCard";
import { ProductGallery } from "@/components/ProductGallery";

import {
  Button,
  Card,
  ChoiceGroup,
  ErrorNote,
  Skeleton,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import { priceForSelections, priceLabel } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type { Product, Store } from "@/lib/types";

export default function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const cart = useCart();
  const toast = useToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.product(id), api.store()])
      .then(([p, s]) => {
        setProduct(p);
        setStore(s);
        const initial: Record<string, string> = {};
        for (const opt of p.options ?? []) {
          if (opt.values.length === 1) initial[opt.name] = opt.values[0]!;
        }
        setSelections(initial);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [id]);

  const closeLabel = useCountdown(product?.closeAt ?? null);

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

  const isOrder = product.type === "order";
  const soldOut =
    product.status === "SOLD_OUT" || (!isOrder && product.stock <= 0);
  const closed = product.status === "CLOSED";
  const blocked = soldOut || closed;
  const options = product.options ?? [];
  const missingOpt = options.find((o) => !selections[o.name]);
  const unitPrice = priceForSelections(
    product.price,
    product.optionPrices,
    selections,
  );
  const total = unitPrice * qty;

  const addToCart = () => {
    if (missingOpt) {
      const message = `${missingOpt.name}-г сонгоно уу.`;
      setNotice(message);
      toast.error(message);
      return;
    }
    cart.add({
      productId: product.id,
      name: product.name,
      price: unitPrice,
      image: product.images[0] ?? null,
      type: product.type,
      selections: { ...selections },
      size: selections["Хэмжээ"] ?? null,
      color: selections["Өнгө"] ?? null,
      qty,
      arriveFrom: product.arriveFrom,
      arriveTo: product.arriveTo,
      stock: product.stock,
    });
    toast.success("Сагсанд нэмэгдлээ. Өөр бараа нэмж болно.");
  };

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
                {missingOpt
                  ? priceLabel(product.price, product.priceMax)
                  : money(unitPrice)}
              </div>
            </div>

            {product.description && (
              <div className='mt-0 rounded-[12px] border border-line bg-surface p-4 lg:mt-6 lg:p-5'>
                <div className='text-[15px] font-medium lg:text-[17px]'>
                  Тайлбар
                </div>
                <div className='mt-2 text-[14px] leading-[1.75] text-ink-2 lg:mt-2.5 lg:text-[15px] lg:max-w-[440px]'>
                  <p className='m-0 whitespace-pre-line'>
                    {product.description}
                  </p>
                </div>
              </div>
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

            {!blocked &&
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
                      options={opt.values.map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      value={selected}
                      onChange={(v) => {
                        setSelections((prev) => ({ ...prev, [opt.name]: v }));
                        setNotice(null);
                      }}
                    />
                  </div>
                );
              })}

            {!blocked && (
              <div className='lg:hidden'>
                <div className='mb-2.5 text-[15px] font-medium'>Тоо ширхэг</div>
                <div className='flex items-center gap-3'>
                  <Stepper
                    qty={qty}
                    max={isOrder ? 50 : Math.max(1, product.stock)}
                    onChange={setQty}
                  />
                  <span className='tnum text-[15px] text-ink-2'>
                    = {money(total)}
                  </span>
                </div>
              </div>
            )}

            {notice && <ErrorNote>{notice}</ErrorNote>}

            <div className='hidden lg:flex lg:flex-col lg:gap-2'>
              {blocked ? (
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
                      max={isOrder ? 50 : Math.max(1, product.stock)}
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
        {blocked ? (
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

/**
 * Барааны тайлбар — «Энэ бараа хэрхэн ирэх вэ» хэсгийн оронд, яг тэр
 * байрлалд (desktop: үнэ ба key facts хооронд, mobile: qty stepper ба
 * доод CTA хооронд) гарна.
 */
function ProductDescription({
  description,
  className = "",
}: {
  description: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[12px] border border-line bg-surface p-4 lg:p-5 ${className}`}
    >
      <div className='text-[15px] font-medium lg:text-[17px]'>Тайлбар</div>
      <div className='mt-2 text-[14px] leading-[1.75] text-ink-2 lg:mt-2.5 lg:max-w-[440px] lg:text-[15px]'>
        <p className='m-0 whitespace-pre-line'>{description}</p>
      </div>
    </div>
  );
}

/**
 * Худалдан авах шийдвэрт нөлөөлдөг зүйлс — хэзээ гартаа авах, хэзээ хаагдах,
 * хэдэн ширхэг үлдсэн. Эдгээрийг хайж олох биш, шууд харагдах ёстой.
 */
function KeyFacts({
  product,
  closeLabel,
  soldOut,
  closed,
}: {
  product: Product;
  closeLabel: string;
  soldOut: boolean;
  closed: boolean;
}) {
  const isOrder = product.type === "order";

  // Laptop дээр эдгээр нь зурган дээрх шошго болж хуваагдана.
  return (
    <div className='lg:hidden'>
      <div className='divide-y divide-line rounded-[12px] border border-line'>
        {isOrder && !closed && closeLabel && (
          <Fact
            icon='clock'
            label='Захиалга хаагдах'
            value={closeLabel}
            tone='warn'
          />
        )}

        {!isOrder && (
          <Fact
            icon='box'
            label='Үлдэгдэл'
            value={soldOut ? "Дууссан" : `${product.stock} ширхэг`}
            tone={soldOut ? "danger" : "ok"}
          />
        )}
      </div>
    </div>
  );
}

const FACT_ICONS: Record<string, React.ReactNode> = {
  truck: (
    <path d='M1.5 5h7v6h-7zM8.5 8h2.5l1.5 2v1h-4zM3.3 12.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM9.7 12.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z' />
  ),
  clock: (
    <>
      <circle cx='7' cy='7' r='5.5' />
      <path d='M7 4v3l2 1.2' />
    </>
  ),
  box: (
    <>
      <path d='M1.5 4.5 7 2l5.5 2.5L7 7 1.5 4.5z' />
      <path d='M1.5 4.5v5.2L7 12l5.5-2.3V4.5' />
      <path d='M7 7v5' />
    </>
  ),
  card: (
    <>
      <rect x='1.5' y='3' width='11' height='8' rx='1.2' />
      <path d='M1.5 5.5h11' />
    </>
  ),
};

function Fact({
  icon,
  label,
  value,
  strong,
  tone = "neutral",
}: {
  icon: keyof typeof FACT_ICONS;
  label: string;
  value: string;
  strong?: boolean;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  const colors = {
    neutral: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
  };
  const iconColors = {
    neutral: "text-ink-2",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
  };

  const glyph = (
    <svg
      width={strong ? 16 : 14}
      height={strong ? 16 : 14}
      viewBox='0 0 14 14'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={`shrink-0 ${iconColors[tone]}`}
      aria-hidden
    >
      {FACT_ICONS[icon]}
    </svg>
  );

  // Гарт очих огноо урт байдаг тул шошгыг дээр нь тавьж, тасрахаас сэргийлнэ.
  if (strong) {
    return (
      <div className='flex items-start gap-2.5 px-4 py-3.5'>
        <span className='mt-[3px]'>{glyph}</span>
        <div>
          <div className='text-[13px] text-ink-2'>{label}</div>
          <div
            className={`tnum text-[19px] font-medium leading-tight ${colors[tone]}`}
          >
            {value}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex items-center justify-between gap-3 px-4 py-3'>
      <span className='flex items-center gap-2 text-[14px] text-ink-2'>
        {glyph}
        {label}
      </span>
      <span className={`tnum text-right text-[15px] ${colors[tone]}`}>
        {value}
      </span>
    </div>
  );
}

function Stepper({
  qty,
  max,
  onChange,
  size = "md",
}: {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
  /** md — мобайлын 44px, lg — дизайны laptop дээрх 48px. */
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "h-12" : "h-11";
  const key = size === "lg" ? "w-12 text-[18px]" : "w-11 text-[18px]";
  const value = size === "lg" ? "w-10 text-[16px]" : "w-10 text-[15px]";

  return (
    <div
      className={`flex shrink-0 items-center rounded-[8px] border border-line ${box}`}
    >
      <button
        type='button'
        aria-label='Хасах'
        onClick={() => onChange(Math.max(1, qty - 1))}
        className={`h-full cursor-pointer border-0 bg-transparent text-ink disabled:opacity-30 ${key}`}
        disabled={qty <= 1}
      >
        −
      </button>
      <span className={`tnum text-center ${value}`}>{qty}</span>
      <button
        type='button'
        aria-label='Нэмэх'
        onClick={() => onChange(Math.min(max, qty + 1))}
        className={`h-full cursor-pointer border-0 bg-transparent text-ink disabled:opacity-30 ${key}`}
        disabled={qty >= max}
      >
        +
      </button>
    </div>
  );
}
