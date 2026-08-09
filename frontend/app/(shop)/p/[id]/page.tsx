"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useCountdown } from "@/components/ProductCard";
import { ProductImage } from "@/components/ProductImage";
import {
  Badge,
  Button,
  Card,
  ChoiceGroup,
  Divider,
  ErrorNote,
  ImagePlaceholder,
  Spinner,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { arrivalLabel, dayLabel, money, rangeLabel } from "@/lib/format";
import type { Product, Store } from "@/lib/types";

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
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
      <div className="p-4">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/" className="no-underline">
          <Button className="mt-4" variant="outline">
            Нүүр хуудас
          </Button>
        </Link>
      </div>
    );
  }

  if (!product || !store) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const isOrder = product.type === "order";
  const soldOut = product.status === "SOLD_OUT" || (!isOrder && product.stock <= 0);
  const closed = product.status === "CLOSED";
  const blocked = soldOut || closed;
  const missing =
    (product.sizes.length > 0 && !size) || (product.colors.length > 0 && !color);
  const total = product.price * qty;

  const addToCart = () => {
    if (missing) {
      setNotice(
        product.sizes.length > 0 && !size ? "Хэмжээгээ сонгоно уу." : "Өнгөө сонгоно уу.",
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
    <div className="page pb-28 lg:pb-12">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg px-2 py-2 lg:px-4">
        <BackButton />
        <span className="truncate text-[15px]">{product.name}</span>
      </div>

      {/* Desktop дээр зүүн талд зураг, баруун талд мэдээлэл */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-start lg:gap-10 lg:px-8 lg:pt-6">
      <div className="lg:sticky lg:top-20 lg:overflow-hidden lg:rounded-[12px] lg:border lg:border-line">
      <Gallery images={product.images} name={product.name} />
      </div>

      <div className="lg:min-w-0">
      <div className="flex flex-col gap-2 px-4 pt-4 lg:px-0 lg:pt-0">
        <Badge tone={isOrder ? "neutral" : "ok"} className="self-start">
          {isOrder ? "Захиалгын бараа" : "Бэлэн бараа"}
        </Badge>
        <h1 className="m-0 text-[20px] font-medium leading-[1.4]">{product.name}</h1>
        <div className="tnum text-[24px] font-medium">{money(product.price)}</div>
        {!isOrder && (
          <div className="text-[13px] text-ok">
            {soldOut ? "Дууссан" : `Үлдэгдэл ${product.stock} ширхэг`}
          </div>
        )}
      </div>

      <HowItArrives product={product} closeLabel={closeLabel} />

      {product.sizes.length > 0 && (
        <div className="px-4 lg:px-0 pt-6">
          <div className="mb-2 text-[15px] font-medium">Хэмжээ</div>
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

      {product.colors.length > 0 && (
        <div className="px-4 lg:px-0 pt-5">
          <div className="mb-2 text-[15px] font-medium">Өнгө</div>
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

      <div className="px-4 lg:px-0 pt-5">
        <div className="mb-2 text-[15px] font-medium">Тоо ширхэг</div>
        <div className="flex items-center gap-3">
          <Stepper
            qty={qty}
            max={isOrder ? 50 : Math.max(1, product.stock)}
            onChange={setQty}
          />
          <span className="tnum text-[15px] text-ink-2">= {money(total)}</span>
        </div>
      </div>

      {notice && (
        <div className="px-4 pt-4">
          <ErrorNote>{notice}</ErrorNote>
        </div>
      )}

      {product.description && (
        <div className="px-4 lg:px-0 pt-6">
          <div className="mb-2 text-[15px] font-medium">Тайлбар</div>
          <p className="m-0 whitespace-pre-line text-[14px] leading-[1.6] text-ink-2">
            {product.description}
          </p>
        </div>
      )}

      {product.sizeChart.length > 0 && (
        <div className="px-4 lg:px-0 pt-6">
          <div className="mb-2 text-[15px] font-medium">Хэмжээсийн хүснэгт</div>
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface text-ink-2">
                  <th className="p-2.5 text-left font-normal">Хэмжээ</th>
                  <th className="p-2.5 text-left font-normal">Өндөр</th>
                  <th className="p-2.5 text-left font-normal">Цээж</th>
                </tr>
              </thead>
              <tbody>
                {product.sizeChart.map((row, i) => (
                  <tr key={`${row.size}-${i}`} className="border-t border-line">
                    <td className="p-2.5">{row.size}</td>
                    <td className="tnum p-2.5 text-ink-2">{row.heightRange}</td>
                    <td className="tnum p-2.5 text-ink-2">{row.chestCm}</td>
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
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[560px] items-center gap-3 border-t border-line bg-bg p-4
        lg:static lg:mx-8 lg:mt-8 lg:max-w-none lg:rounded-[12px] lg:border">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-muted">Нийт төлөх</div>
          <div className="tnum text-[17px] font-medium">{money(total)}</div>
        </div>
        <Button size="lg" onClick={addToCart} disabled={blocked} className="min-w-[160px]">
          {closed ? "Захиалга хаагдсан" : soldOut ? "Дууссан" : isOrder ? "Захиалах" : "Сагсанд хийх"}
        </Button>
      </div>
    </div>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Буцах"
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4 L6 10 L12 16" />
      </svg>
    </button>
  );
}

function Gallery({ images, name }: { images: string[]; name: string }) {
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return <ImagePlaceholder className="aspect-square w-full border-b border-line" />;
  }

  return (
    <div className="relative">
      <div
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {images.map((src) => (
          <ProductImage
            key={src}
            src={src}
            alt={name}
            className="aspect-square w-full shrink-0 snap-center"
          />
        ))}
      </div>
      {images.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
          {images.map((src, i) => (
            <span
              key={src}
              className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-ink" : "bg-muted"}`}
            />
          ))}
        </div>
      )}
    </div>
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
    <div className="flex h-11 items-center rounded-[8px] border border-line">
      <button
        type="button"
        aria-label="Хасах"
        onClick={() => onChange(Math.max(1, qty - 1))}
        className="h-full w-11 cursor-pointer border-0 bg-transparent text-[18px] text-ink disabled:opacity-30"
        disabled={qty <= 1}
      >
        −
      </button>
      <span className="tnum w-10 text-center text-[15px]">{qty}</span>
      <button
        type="button"
        aria-label="Нэмэх"
        onClick={() => onChange(Math.min(max, qty + 1))}
        className="h-full w-11 cursor-pointer border-0 bg-transparent text-[18px] text-ink disabled:opacity-30"
        disabled={qty >= max}
      >
        +
      </button>
    </div>
  );
}

/** Дизайны хамгийн чухал блок — 4 алхамын timeline, тус бүр огноотой. */
function HowItArrives({ product, closeLabel }: { product: Product; closeLabel: string }) {
  const steps = product.closeAt
    ? [
        { label: "Захиалга хаагдана", value: dayLabel(product.closeAt) },
        { label: "Нийлүүлэгч рүү явна", value: dayLabel(addDays(product.closeAt, 1)) },
        {
          label: "Тээвэрлэгдэнэ",
          value: rangeLabel(addDays(product.closeAt, 2), product.arriveFrom),
        },
        { label: "Гарт очно", value: rangeLabel(product.arriveFrom, product.arriveTo) },
      ]
    : [
        { label: "Агуулахад бэлэн", value: "Одоо" },
        { label: "Захиалга баталгаажна", value: "Тухайн өдөртөө" },
        { label: "Гарт очно", value: arrivalLabel(product) },
      ];

  return (
    <Card surface className="mx-4 mt-6 flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[15px] font-medium">Энэ бараа хэрхэн ирэх вэ</div>
        {product.closeAt && closeLabel && closeLabel !== "Хаагдсан" && (
          <span className="tnum text-[12px] text-warn">{closeLabel}</span>
        )}
      </div>

      <ol className="m-0 flex list-none flex-col gap-0 p-0">
        {steps.map((step, i) => (
          <li key={step.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-muted bg-bg" />
              {i < steps.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>
            <div className={`flex-1 ${i < steps.length - 1 ? "pb-4" : ""}`}>
              <div className="text-[14px]">{step.label}</div>
              <div className="tnum text-[13px] text-ink-2">{step.value}</div>
            </div>
          </li>
        ))}
      </ol>

      <p className="m-0 text-[12px] text-muted">Огноо ойролцоо. Өөрчлөгдвөл мэдэгдэнэ.</p>
    </Card>
  );
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}
