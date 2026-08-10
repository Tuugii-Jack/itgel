"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useCountdown } from "@/components/ProductCard";
import { ProductGallery } from "@/components/ProductGallery";

import {
  Badge,
  Button,
  Card,
  ChoiceGroup,
  ErrorNote,
  Spinner,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { arrivalLabel, dayLabel, money, rangeLabel } from "@/lib/format";
import type { Product, Store } from "@/lib/types";

export default function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const cart = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.product(id), api.store()])
      .then(([p, s]) => {
        setProduct(p);
        setStore(s);
        if (p.sizes.length === 1) setSize(p.sizes[0]!);
        if (p.colors.length === 1) setColor(p.colors[0]!);
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
      <div className='flex justify-center py-24'>
        <Spinner className='text-muted' />
      </div>
    );
  }

  const isOrder = product.type === "order";
  const soldOut =
    product.status === "SOLD_OUT" || (!isOrder && product.stock <= 0);
  const closed = product.status === "CLOSED";
  const blocked = soldOut || closed;
  const missing =
    (product.sizes.length > 0 && !size) ||
    (product.colors.length > 0 && !color);
  const total = product.price * qty;

  const addToCart = () => {
    if (missing) {
      setNotice(
        product.sizes.length > 0 && !size
          ? "Хэмжээгээ сонгоно уу."
          : "Өнгөө сонгоно уу.",
      );
      return;
    }
    cart.add({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.images[0] ?? null,
      type: product.type,
      size,
      color,
      qty,
      arriveFrom: product.arriveFrom,
      arriveTo: product.arriveTo,
      stock: product.stock,
    });
    router.push("/cart");
  };

  return (
    <div className='page pb-28 lg:pb-12'>
      <div className='sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg px-2 py-2 lg:px-4'>
        <BackButton />
        <span className='truncate text-[15px]'>{product.name}</span>
      </div>

      {/* Desktop дээр зүүн талд зураг, баруун талд мэдээлэл */}
      <div className='lg:grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start lg:gap-12 lg:px-8 lg:pt-8'>
        {/* Зураг — хуудасны хамгийн чухал элемент тул тод, тусдаа орчинтой. */}
        <div className='lg:sticky lg:top-20'>
          <div className='border-b border-line bg-surface p-3 sm:p-4 lg:rounded-[16px] lg:border'>
            <ProductGallery images={product.images} alt={product.name} />
          </div>
        </div>

        <div className='lg:min-w-0'>
          {blocked && (
            <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
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
            </div>
          )}

          <div className='flex flex-col gap-2.5 px-4 pt-5 lg:px-0 lg:pt-0'>
            <Badge tone={isOrder ? "neutral" : "ok"} className='self-start'>
              {isOrder ? "Захиалгын бараа" : "Бэлэн бараа"}
            </Badge>
            <h1 className='m-0 text-[21px] font-medium leading-[1.35] lg:text-[26px]'>
              {product.name}
            </h1>
            <div className='tnum text-[30px] font-semibold leading-none tracking-tight lg:text-[34px]'>
              {money(product.price)}
            </div>
          </div>

          {/* Худалдан авах шийдвэрт нөлөөлөх гурван зүйл — эхэнд, том. */}
          <KeyFacts
            product={product}
            closeLabel={closeLabel}
            soldOut={soldOut}
            closed={closed}
          />

          {!blocked && product.sizes.length > 0 && (
            <div className='px-4 lg:px-0 pt-7'>
              <div className='mb-2.5 flex items-baseline gap-1.5 text-[15px] font-medium'>
                Хэмжээ
                {size && <span className='tnum text-ink-2'>· {size}</span>}
              </div>
              <ChoiceGroup
                options={product.sizes.map((s) => ({ value: s, label: s }))}
                value={size}
                onChange={(v) => {
                  setSize(v);
                  setNotice(null);
                }}
              />
            </div>
          )}

          {!blocked && product.colors.length > 0 && (
            <div className='px-4 lg:px-0 pt-6'>
              <div className='mb-2.5 flex items-baseline gap-1.5 text-[15px] font-medium'>
                Өнгө
                {color && <span className='text-ink-2'>· {color}</span>}
              </div>
              <ChoiceGroup
                options={product.colors.map((c) => ({ value: c, label: c }))}
                value={color}
                onChange={(v) => {
                  setColor(v);
                  setNotice(null);
                }}
              />
            </div>
          )}

          {!blocked && (
            <div className='px-4 lg:px-0 pt-6'>
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

          {notice && (
            <div className='px-4 pt-4 lg:px-0'>
              <ErrorNote>{notice}</ErrorNote>
            </div>
          )}

          <HowItArrives product={product} />

          {product.description && (
            <div className='px-4 lg:px-0 pt-7'>
              <div className='mb-2 text-[15px] font-medium'>Тайлбар</div>
              <p className='m-0 whitespace-pre-line text-[14px] leading-[1.65] text-ink-2'>
                {product.description}
              </p>
            </div>
          )}

          {product.sizeChart.length > 0 && (
            <div className='px-4 lg:px-0 pt-7'>
              <div className='mb-2 text-[15px] font-medium'>
                Хэмжээсийн хүснэгт
              </div>
              <Card className='overflow-hidden'>
                <table className='w-full border-collapse text-[13px]'>
                  <thead>
                    <tr className='bg-surface text-ink-2'>
                      <th className='p-2.5 text-left font-normal'>Хэмжээ</th>
                      <th className='p-2.5 text-left font-normal'>Өндөр</th>
                      <th className='p-2.5 text-left font-normal'>Цээж</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.sizeChart.map((row, i) => (
                      <tr
                        key={`${row.size}-${i}`}
                        className='border-t border-line'
                      >
                        <td className='p-2.5'>{row.size}</td>
                        <td className='tnum p-2.5 text-ink-2'>
                          {row.heightRange}
                        </td>
                        <td className='tnum p-2.5 text-ink-2'>{row.chestCm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Утсан дээр наалдсан, desktop дээр урсгалын дотор */}
      <div
        className='fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[560px] items-center gap-3 border-t border-line bg-bg p-4
        shadow-[0_-8px_24px_rgba(20,20,25,0.06)]
        pb-[calc(1rem+env(safe-area-inset-bottom))]
        lg:static lg:mx-8 lg:mt-8 lg:max-w-none lg:rounded-[12px] lg:border lg:pb-4 lg:shadow-none'
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
              {isOrder ? "Захиалах" : "Сагсанд хийх"}
            </Button>
          </>
        )}
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

  return (
    <div className='px-4 pt-6 lg:px-0'>
      <div className='divide-y divide-line rounded-[12px] border border-line'>
        <Fact
          icon='truck'
          label='Гарт очих'
          value={arrivalLabel(product)}
          strong
        />

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

        <Fact icon='card' label='Төлбөр' value='Захиалахад бүтнээр төлнө' />
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

function BackButton() {
  const router = useRouter();
  return (
    <button
      type='button'
      onClick={() => router.back()}
      aria-label='Буцах'
      className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent'
    >
      <svg
        width='20'
        height='20'
        viewBox='0 0 20 20'
        fill='none'
        stroke='#1C1917'
        strokeWidth='1.4'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M12 4 L6 10 L12 16' />
      </svg>
    </button>
  );
}

function Stepper({
  qty,
  max,
  onChange,
}: {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
}) {
  return (
    <div className='flex h-11 items-center rounded-[8px] border border-line'>
      <button
        type='button'
        aria-label='Хасах'
        onClick={() => onChange(Math.max(1, qty - 1))}
        className='h-full w-11 cursor-pointer border-0 bg-transparent text-[18px] text-ink disabled:opacity-30'
        disabled={qty <= 1}
      >
        −
      </button>
      <span className='tnum w-10 text-center text-[15px]'>{qty}</span>
      <button
        type='button'
        aria-label='Нэмэх'
        onClick={() => onChange(Math.min(max, qty + 1))}
        className='h-full w-11 cursor-pointer border-0 bg-transparent text-[18px] text-ink disabled:opacity-30'
        disabled={qty >= max}
      >
        +
      </button>
    </div>
  );
}

/** Дизайны хамгийн чухал блок — 4 алхамын timeline, тус бүр огноотой. */
function HowItArrives({ product }: { product: Product }) {
  const steps = product.closeAt
    ? [
        { label: "Захиалга хаагдана", value: dayLabel(product.closeAt) },
        {
          label: "Нийлүүлэгч рүү явна",
          value: dayLabel(addDays(product.closeAt, 1)),
        },
        {
          label: "Тээвэрлэгдэнэ",
          value: rangeLabel(addDays(product.closeAt, 2), product.arriveFrom),
        },
        {
          label: "Гарт очно",
          value: rangeLabel(product.arriveFrom, product.arriveTo),
        },
      ]
    : [
        { label: "Агуулахад бэлэн", value: "Одоо" },
        { label: "Захиалга баталгаажна", value: "Тухайн өдөртөө" },
        { label: "Гарт очно", value: arrivalLabel(product) },
      ];

  return (
    <div className='px-4 pt-7 lg:px-0'>
      {/* Дэлгэрэнгүй явц — сонирхсон хүн нээж үзнэ, эхний харцыг бөглөрүүлэхгүй. */}
      <details className='group rounded-[12px] border border-line bg-surface'>
        <summary className='flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-[15px] font-medium'>
          Энэ бараа хэрхэн ирэх вэ
          <svg
            width='16'
            height='16'
            viewBox='0 0 16 16'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.4'
            strokeLinecap='round'
            strokeLinejoin='round'
            className='shrink-0 text-muted transition-transform group-open:rotate-180'
            aria-hidden
          >
            <path d='M4 6 L8 10 L12 6' />
          </svg>
        </summary>

        <div className='flex flex-col gap-3 px-4 pb-4'>
          <ol className='m-0 flex list-none flex-col gap-0 p-0'>
            {steps.map((step, i) => (
              <li key={step.label} className='flex gap-3'>
                <div className='flex flex-col items-center'>
                  <span className='mt-1.5 h-2 w-2 shrink-0 rounded-full border border-muted bg-bg' />
                  {i < steps.length - 1 && (
                    <span className='w-px flex-1 bg-line' />
                  )}
                </div>
                <div className={`flex-1 ${i < steps.length - 1 ? "pb-4" : ""}`}>
                  <div className='text-[14px]'>{step.label}</div>
                  <div className='tnum text-[13px] text-ink-2'>
                    {step.value}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <p className='m-0 text-[12px] text-muted'>
            Огноо ойролцоо. Өөрчлөгдвөл мэдэгдэнэ.
          </p>
        </div>
      </details>
    </div>
  );
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}
